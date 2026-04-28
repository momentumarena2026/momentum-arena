"use server";

import { db } from "@/lib/db";
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
  | { kind: "user"; userId: string };

export interface BroadcastInput {
  audience: BroadcastAudience;
  title: string;
  body: string;
  // Optional deep-link the mobile tap handler uses to route on tap.
  // Leave null and the tap just opens the app to its current screen.
  deepLinkBookingId?: string;
  deepLinkCafeOrderId?: string;
  // When true, the call returns the audience size without actually
  // sending — used by the form's "Send to N devices" preview.
  dryRun?: boolean;
}

export async function sendBroadcast(input: BroadcastInput) {
  await requireAdmin(PERMISSION);

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
  }

  const result = await sendToTokens(
    devices.map((d) => d.token),
    { title, body, data },
  );

  return { ok: true as const, dryRun: false, ...result };
}

// Quick "send a hello world push to my own user" — useful for verifying
// FCM is working end-to-end after a config change without having to
// trigger a real booking flow.
export async function sendTestPushToUser(userId: string) {
  await requireAdmin(PERMISSION);
  return sendToUser(userId, {
    title: "Test from Momentum Arena admin",
    body: "If you see this, push notifications are wired correctly.",
    data: { kind: "broadcast" },
  });
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
