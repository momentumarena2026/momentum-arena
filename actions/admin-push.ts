"use server";

import { db } from "@/lib/db";
import { PUSH_TEMPLATES } from "@/lib/push-templates";
import { requireAdmin } from "@/lib/admin-auth";
import {
  sendToTokens,
  sendToUser,
  type PushKind,
  type PushPayload,
} from "@/lib/push";

const PERMISSION = "MANAGE_PUSH";

// Aggregate stats for the dashboard top-of-page cards. All counts are
// computed in parallel — none are large enough to warrant pre-aggregation,
// and the whole query set returns in well under a second on the dev DB.
export async function getPushStats() {
  await requireAdmin(PERMISSION);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalDevices,
    androidDevices,
    iosDevices,
    activeUserIds,
    sent7d,
    failed7d,
    skipped7d,
    sent30d,
    staleDevices,
  ] = await Promise.all([
    db.pushDevice.count(),
    db.pushDevice.count({ where: { platform: "android" } }),
    db.pushDevice.count({ where: { platform: "ios" } }),
    // distinct userIds with at least one device — answers "how many of
    // your users can we reach via push at all?"
    db.pushDevice
      .findMany({ select: { userId: true }, distinct: ["userId"] })
      .then((rows) => rows.length),
    db.notification.count({
      where: {
        channel: "push",
        status: "sent",
        createdAt: { gte: sevenDaysAgo },
      },
    }),
    db.notification.count({
      where: {
        channel: "push",
        status: "failed",
        createdAt: { gte: sevenDaysAgo },
      },
    }),
    db.notification.count({
      where: {
        channel: "push",
        status: "skipped",
        createdAt: { gte: sevenDaysAgo },
      },
    }),
    db.notification.count({
      where: {
        channel: "push",
        status: "sent",
        createdAt: { gte: thirtyDaysAgo },
      },
    }),
    // Devices that haven't checked in in 30 days. Likely uninstalled or
    // signed out from another device. Surfaces the prune-token CTA.
    db.pushDevice.count({ where: { lastSeenAt: { lt: thirtyDaysAgo } } }),
  ]);

  const attempted7d = sent7d + failed7d;
  const successRate7d =
    attempted7d === 0 ? null : Math.round((sent7d / attempted7d) * 100);

  return {
    totalDevices,
    androidDevices,
    iosDevices,
    activeUsers: activeUserIds,
    sent7d,
    failed7d,
    skipped7d,
    sent30d,
    successRate7d,
    staleDevices,
  };
}

export interface PushNotificationRow {
  id: string;
  bookingId: string;
  channel: string;
  status: string;
  sentAt: Date | null;
  error: string | null;
  createdAt: Date;
  bookingUserName: string | null;
  bookingUserPhone: string | null;
}

// Recent push entries from the Notification table. We surface booking +
// user info so the admin can correlate a failed push back to the affected
// customer without clicking through.
export async function getRecentPushNotifications(
  limit = 50,
): Promise<PushNotificationRow[]> {
  await requireAdmin(PERMISSION);

  const rows = await db.notification.findMany({
    where: { channel: "push" },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  if (rows.length === 0) return [];

  // Single round-trip to fetch the user info for the unique bookingIds in
  // the result. The join can't be done in one query because Notification
  // has no FK relation declared to Booking in the schema.
  const bookingIds = Array.from(new Set(rows.map((r) => r.bookingId)));
  const bookings = await db.booking.findMany({
    where: { id: { in: bookingIds } },
    select: {
      id: true,
      user: { select: { name: true, phone: true } },
    },
  });
  const bookingMap = new Map(bookings.map((b) => [b.id, b]));

  return rows.map((r) => {
    const b = bookingMap.get(r.bookingId);
    return {
      id: r.id,
      bookingId: r.bookingId,
      channel: r.channel,
      status: r.status,
      sentAt: r.sentAt,
      error: r.error,
      createdAt: r.createdAt,
      bookingUserName: b?.user?.name ?? null,
      bookingUserPhone: b?.user?.phone ?? null,
    };
  });
}

export interface PushDeviceRow {
  id: string;
  platform: string;
  appVersion: string | null;
  tokenPreview: string;
  lastSeenAt: Date;
  createdAt: Date;
  userId: string;
  userName: string | null;
  userPhone: string | null;
}

export async function getPushDevices(filters?: {
  platform?: string;
  page?: number;
  limit?: number;
}): Promise<{
  devices: PushDeviceRow[];
  total: number;
  page: number;
  totalPages: number;
}> {
  await requireAdmin(PERMISSION);

  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 50;
  const where: Record<string, unknown> = {};
  if (filters?.platform) where.platform = filters.platform;

  const [rows, total] = await Promise.all([
    db.pushDevice.findMany({
      where,
      include: { user: { select: { name: true, phone: true } } },
      orderBy: { lastSeenAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.pushDevice.count({ where }),
  ]);

  // Token is sensitive (it can be used to send pushes to that device if
  // someone exfiltrates the admin DB dump). Only expose the first/last 6
  // chars so admins can correlate without leaking the full value.
  const devices: PushDeviceRow[] = rows.map((d) => ({
    id: d.id,
    platform: d.platform,
    appVersion: d.appVersion,
    tokenPreview: `${d.token.slice(0, 6)}…${d.token.slice(-6)}`,
    lastSeenAt: d.lastSeenAt,
    createdAt: d.createdAt,
    userId: d.userId,
    userName: d.user?.name ?? null,
    userPhone: d.user?.phone ?? null,
  }));

  return { devices, total, page, totalPages: Math.ceil(total / limit) };
}

// User-group dropdown for the broadcast form. Returns each active group
// with its member count and how many of those members have a registered
// push device — so admins know the actual reach before they hit Send.
//
// requireAdmin resolves the caller from the web cookie session OR the
// mobile Bearer JWT, so mobile admin routes reuse this as-is.
export async function getActiveUserGroupsForPush() {
  await requireAdmin(PERMISSION);

  const groups = await db.userGroup.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      _count: { select: { members: true } },
      members: { select: { userId: true } },
    },
    orderBy: { name: "asc" },
  });

  if (groups.length === 0) return [];

  // Compute reachable-device counts in one round-trip rather than N+1.
  const allMemberIds = Array.from(
    new Set(groups.flatMap((g) => g.members.map((m) => m.userId))),
  );
  const memberDevices = await db.pushDevice.findMany({
    where: { userId: { in: allMemberIds } },
    select: { userId: true },
  });
  const userIdToHasDevice = new Set(memberDevices.map((d) => d.userId));

  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    memberCount: g._count.members,
    deviceCount: g.members.filter((m) => userIdToHasDevice.has(m.userId)).length,
  }));
}

// User search for the broadcast form's "specific user" audience. Restricted
// to phone / name match — admins searching for "amazon" shouldn't enumerate
// every user in the DB by typing a single character.
export async function searchUsersForPush(query: string) {
  await requireAdmin(PERMISSION);
  const q = query.trim();
  if (q.length < 2) return [];

  const digits = q.replace(/\D/g, "");
  const rows = await db.user.findMany({
    where: {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
      ],
    },
    select: {
      id: true,
      name: true,
      phone: true,
      pushDevices: { select: { id: true, platform: true } },
    },
    take: 10,
    orderBy: { createdAt: "desc" },
  });

  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    phone: u.phone,
    deviceCount: u.pushDevices.length,
    platforms: Array.from(new Set(u.pushDevices.map((d) => d.platform))),
  }));
}

export type BroadcastAudience =
  | { kind: "all" }
  | { kind: "platform"; platform: "android" | "ios" }
  | { kind: "user"; userId: string }
  // Admin-curated cohort (UserGroup model — same one coupons target).
  // Resolved at send time to all members' devices.
  | { kind: "group"; groupId: string };

// In-app screen a broadcast tap should open. Maps to the customer
// tabs; the mobile tap handler navigates to the matching tab.
export type BroadcastDestination = "home" | "book" | "cafe" | "shop" | "rewards";

export interface BroadcastInput {
  audience: BroadcastAudience;
  title: string;
  body: string;
  // Optional tap destination. A screen (BroadcastDestination) opens the
  // matching tab; deepLinkBookingId/CafeOrderId pin a specific entity.
  // Leave all unset and the tap just opens the app to its current screen.
  destination?: BroadcastDestination;
  deepLinkBookingId?: string;
  deepLinkCafeOrderId?: string;
  // When true, the call returns the audience size without actually
  // sending — used by the form's "Send to N devices" preview.
  dryRun?: boolean;
}

export async function sendBroadcast(input: BroadcastInput) {
  // Attribution comes from the verified identity only — never from the
  // client. requireAdmin resolves the web cookie session OR the mobile
  // Bearer JWT, so the mobile admin route needs no override.
  const admin = await requireAdmin(PERMISSION);

  // Validation. We don't want admins to send empty pushes or accidentally
  // send something with shoddy formatting (the empty-title push shows up
  // as a blank banner on iOS).
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) {
    return { ok: false as const, error: "Title and body are required" };
  }
  if (title.length > 100 || body.length > 500) {
    return {
      ok: false as const,
      error: "Title must be ≤100 chars and body ≤500 chars",
    };
  }

  // Resolve audience → token list.
  const where: Record<string, unknown> = {};
  if (input.audience.kind === "platform") {
    where.platform = input.audience.platform;
  } else if (input.audience.kind === "user") {
    where.userId = input.audience.userId;
  } else if (input.audience.kind === "group") {
    // Translate group → list of member userIds → device filter. Doing
    // this in two queries (instead of a relational `user: { groupMemberships: { some: ... } }`
    // filter) keeps the query plan trivial and the audience-size
    // preview cheap. Group must not be soft-deleted.
    const group = await db.userGroup.findUnique({
      where: { id: input.audience.groupId },
      select: { id: true, deletedAt: true, members: { select: { userId: true } } },
    });
    if (!group || group.deletedAt) {
      return { ok: false as const, error: "User group not found" };
    }
    if (group.members.length === 0) {
      return { ok: false as const, error: "User group has no members" };
    }
    where.userId = { in: group.members.map((m) => m.userId) };
  }
  const devices = await db.pushDevice.findMany({
    where,
    select: { token: true },
  });

  if (devices.length === 0) {
    return { ok: false as const, error: "No registered devices match this audience" };
  }

  if (input.dryRun) {
    return {
      ok: true as const,
      dryRun: true,
      attempted: devices.length,
      succeeded: 0,
      failed: 0,
      cleanedUp: 0,
    };
  }

  // Build payload. Use `broadcast` kind so the mobile tap handler doesn't
  // try to navigate to a non-existent booking; admins can still pin a
  // booking/cafeOrder for routing if they want.
  const data: PushPayload["data"] = { kind: "broadcast" satisfies PushKind };
  if (input.deepLinkBookingId) {
    data.kind = "booking_confirmed";
    data.bookingId = input.deepLinkBookingId;
  } else if (input.deepLinkCafeOrderId) {
    data.kind = "cafe_order_status";
    data.cafeOrderId = input.deepLinkCafeOrderId;
  } else if (input.destination) {
    data.kind = "open_screen";
    data.screen = input.destination;
  }

  const audienceLabel =
    input.audience.kind === "platform"
      ? input.audience.platform
      : input.audience.kind;
  const result = await sendToTokens(devices.map((d) => d.token), { title, body, data }, {
    source: "broadcast",
    scope: "customer",
    sentByAdminId: admin.id,
    audience: audienceLabel,
  });

  return { ok: true as const, dryRun: false, ...result };
}

// Quick "send a hello world push to my own user" — useful for verifying
// FCM is working end-to-end after a config change without having to
// trigger a real booking flow.
export async function sendTestPushToUser(userId: string) {
  const admin = await requireAdmin(PERMISSION);
  return sendToUser(
    userId,
    {
      title: "Test from Momentum Arena admin",
      body: "If you see this, push notifications are wired correctly.",
      data: { kind: "broadcast" },
    },
    { source: "test", sentByAdminId: admin.id },
  );
}

// Test-push to the calling ADMIN's own registered device(s). Distinct
// from sendTestPushToUser (which targets a customer's PushDevice rows):
// this targets the admin's AdminPushDevice rows so an on-the-go admin can
// fire a self-test from the mobile app and confirm — on the very device
// in their hand — that FCM is wired end-to-end, WITHOUT spamming any
// customer. It also lets the admin preview exactly how their composed
// broadcast will look on a lock screen before sending it for real.
//
// The target adminId is the CALLER's own verified identity — it is never
// accepted from the client. (It used to be a parameter, which made this
// public "use server" export a way for anyone to push to any admin's
// devices.) requireAdmin resolves the mobile Bearer JWT as well as a web
// session, so the mobile admin route needs no override.
export async function sendTestPushToAdmin(override?: {
  title?: string;
  body?: string;
}) {
  const { id: adminId } = await requireAdmin(PERMISSION);

  const devices = await db.adminPushDevice.findMany({
    where: { adminId },
    select: { token: true },
  });
  if (devices.length === 0) {
    return {
      ok: false as const,
      error:
        "No admin device registered for your account. Make sure push is enabled on this device and you're signed in to the admin app.",
    };
  }

  const title = override?.title?.trim() || "Test from Momentum Arena admin";
  const body =
    override?.body?.trim() ||
    "If you see this on your lock screen, push notifications are wired correctly.";

  const result = await sendToTokens(
    devices.map((d) => d.token),
    { title, body, data: { kind: "broadcast" } },
    {
      source: "test",
      scope: "admin",
      sentByAdminId: adminId,
      audience: "self",
    },
  );
  return { ok: true as const, ...result };
}

export async function deletePushDeviceById(id: string) {
  await requireAdmin(PERMISSION);
  await db.pushDevice.delete({ where: { id } });
  return { ok: true as const };
}

// Manual sweep of stale tokens. The dead-token cleanup that lib/push.ts
// runs after each send only catches tokens FCM explicitly rejects;
// devices that simply stopped checking in (uninstall, sign-out from
// another device) are caught here.
export async function pruneStalePushDevices(olderThanDays = 90) {
  await requireAdmin(PERMISSION);
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const result = await db.pushDevice.deleteMany({
    where: { lastSeenAt: { lt: cutoff } },
  });
  return { ok: true as const, deleted: result.count };
}

// ---------------------------------------------------------------------
// Automated push templates (lib/push-templates.ts registry + overrides)
// ---------------------------------------------------------------------

export interface PushTemplateView {
  key: string;
  audience: "customer" | "admin";
  label: string;
  trigger: string;
  defaultTitle: string;
  defaultBody: string;
  variables: { name: string; description: string; example: string }[];
  // Effective values (override ?? default) + override state
  enabled: boolean;
  title: string;
  body: string;
  isCustomized: boolean;
  updatedAt: string | null;
}

/** Registry merged with DB overrides — what the dashboards render. */
export async function listPushTemplates(): Promise<PushTemplateView[]> {
  await requireAdmin(PERMISSION);
  const overrides = await db.pushTemplate.findMany();
  const byKey = new Map(overrides.map((o) => [o.key, o]));
  return PUSH_TEMPLATES.map((def) => {
    const o = byKey.get(def.key);
    return {
      key: def.key,
      audience: def.audience,
      label: def.label,
      trigger: def.trigger,
      defaultTitle: def.defaultTitle,
      defaultBody: def.defaultBody,
      variables: [...def.variables],
      enabled: o?.enabled ?? true,
      title: o?.title?.trim() || def.defaultTitle,
      body: o?.body?.trim() || def.defaultBody,
      isCustomized: !!(o && (o.title || o.body)),
      updatedAt: o?.updatedAt.toISOString() ?? null,
    };
  });
}

/**
 * Update one template's toggle and/or copy. Passing an empty/default-equal
 * title/body clears the override (falls back to the registry default).
 * Placeholders are validated against the template's declared variables so
 * a typo'd {variabel} can't silently ship.
 */
export async function updatePushTemplate(
  key: string,
  input: { enabled?: boolean; title?: string; body?: string },
): Promise<{ success: boolean; error?: string }> {
  const actorId = (await requireAdmin(PERMISSION)).id;

  const def = PUSH_TEMPLATES.find((t) => t.key === key);
  if (!def) return { success: false, error: "Unknown template" };

  const allowed = new Set<string>(def.variables.map((v) => v.name));
  const validate = (text: string, field: string): string | null => {
    if (text.length > (field === "title" ? 120 : 300)) {
      return `${field} is too long`;
    }
    for (const m of text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) {
      if (!allowed.has(m[1])) {
        return `Unknown variable {${m[1]}} — allowed: ${
          def.variables.length
            ? def.variables.map((v) => `{${v.name}}`).join(", ")
            : "none"
        }`;
      }
    }
    return null;
  };

  const title = input.title?.trim();
  const body = input.body?.trim();
  if (title !== undefined) {
    const err = validate(title, "title");
    if (err) return { success: false, error: err };
  }
  if (body !== undefined) {
    const err = validate(body, "body");
    if (err) return { success: false, error: err };
  }

  // Store NULL when the value equals the default (or is blank) so the row
  // reads as "not customized" and future default improvements flow through.
  const normalize = (value: string | undefined, def_: string) =>
    value === undefined ? undefined : value === "" || value === def_ ? null : value;

  await db.pushTemplate.upsert({
    where: { key },
    update: {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(title !== undefined ? { title: normalize(title, def.defaultTitle) } : {}),
      ...(body !== undefined ? { body: normalize(body, def.defaultBody) } : {}),
      updatedByAdminId: actorId,
    },
    create: {
      key,
      enabled: input.enabled ?? true,
      title: normalize(title, def.defaultTitle) ?? null,
      body: normalize(body, def.defaultBody) ?? null,
      updatedByAdminId: actorId,
    },
  });

  return { success: true };
}
