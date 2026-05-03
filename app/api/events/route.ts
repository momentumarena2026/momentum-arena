import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getMobileUser, getMobilePlatform } from "@/lib/mobile-auth";
import type { AnalyticsCategory, Prisma } from "@prisma/client";

/**
 * First-party event ingestion endpoint.
 *
 * Accepts batched analytics events from web (NextAuth cookie),
 * mobile (JWT in Authorization header), or anonymous clients.
 *
 * Behavior:
 *   - Resolves the caller's user via NextAuth cookie OR mobile JWT
 *     OR null (anonymous).
 *   - Resolves / creates an AnalyticsSession by `sessionId`. First
 *     request of a new session populates utm/landingPath/referrer/UA
 *     metadata from the `meta` block.
 *   - Inserts every event in one batch, snapshotting the user's
 *     name+phone into `properties.user` for authenticated callers
 *     (PII-by-design — see the project memory for rationale).
 *   - On the request where an anonymous session first becomes
 *     authenticated, backfills the AnalyticsSession.userId AND every
 *     prior event's userId so funnels stay continuous across sign-in.
 *   - Cohort: the FIRST authenticated event creates a UserCohort
 *     row (frozen forever).
 *
 * Auth: this endpoint is INTENTIONALLY OPEN — anonymous browsers
 * need to fire page_view + sport_selected before they sign in.
 * Soft-rate-limited by request size (max 50 events/req) and by
 * the per-IP RateLimit table (~600 events/min/IP).
 */

const MAX_EVENTS_PER_REQUEST = 50;

const analyticsCategoryEnum = z.enum([
  "BOOKING",
  "PAYMENT",
  "AUTH",
  "CAFE",
  "WAITLIST",
  "NAVIGATION",
  "ADMIN",
  "ERROR",
  "SYSTEM",
]);

const eventSchema = z.object({
  name: z.string().min(1).max(80),
  category: analyticsCategoryEnum.optional(),
  properties: z.record(z.string(), z.any()).optional(),
  occurredAt: z.string().datetime().optional(),
  pageUrl: z.string().url().max(2048).optional(),
});

const metaSchema = z.object({
  landingPath: z.string().max(2048).optional(),
  referrer: z.string().max(2048).optional(),
  utm: z
    .object({
      source: z.string().max(120).optional(),
      medium: z.string().max(120).optional(),
      campaign: z.string().max(120).optional(),
      term: z.string().max(120).optional(),
      content: z.string().max(120).optional(),
    })
    .optional(),
  ua: z
    .object({
      browser: z.string().max(60).optional(),
      os: z.string().max(60).optional(),
      device: z.string().max(60).optional(),
    })
    .optional(),
  appVersion: z.string().max(40).optional(),
});

const bodySchema = z.object({
  // Optional — when missing the server creates a fresh session and
  // returns its id. The client persists this in localStorage (web)
  // or AsyncStorage (mobile) and sends it on every subsequent batch.
  sessionId: z.string().min(1).max(60).optional(),
  events: z.array(eventSchema).min(1).max(MAX_EVENTS_PER_REQUEST),
  meta: metaSchema.optional(),
});

export async function POST(request: NextRequest) {
  // 1. Parse + validate. Bad payloads die fast.
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
      { status: 400 },
    );
  }
  const { sessionId: rawSessionId, events, meta } = parsed.data;

  // 2. Resolve auth + platform + user PII snapshot.
  const { userId, userName, userPhone, platform } = await resolveCaller(request);

  // 3. Find or create the AnalyticsSession. New session creation
  //    happens here in a single insert so the rest of the request
  //    can rely on it existing.
  const session = await ensureSession({
    sessionId: rawSessionId,
    userId,
    platform,
    meta,
  });

  // 4. If the session was anonymous and this request is authenticated,
  //    backfill the session AND every event recorded under this
  //    session ID so the user's full pre-sign-in journey is theirs.
  if (userId && !session.userId) {
    await db.$transaction([
      db.analyticsSession.update({
        where: { id: session.id },
        data: { userId, lastSeenAt: new Date() },
      }),
      db.analyticsEvent.updateMany({
        where: { sessionId: session.id, userId: null },
        data: { userId },
      }),
    ]);
    // Cohort assignment runs lazily — see ensureUserCohort below.
    void ensureUserCohort(userId);
  } else if (userId) {
    // Just bump lastSeenAt for an already-authenticated session.
    void db.analyticsSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });
  }

  // 5. Insert events. We use createMany so a single round-trip
  //    handles the whole batch. We deliberately don't return the
  //    inserted rows — saves ~30% on payload + the client doesn't
  //    need the IDs back.
  const userPiiSnapshot =
    userId && (userName || userPhone)
      ? { id: userId, name: userName, phone: userPhone }
      : null;

  const rows: Prisma.AnalyticsEventCreateManyInput[] = events.map((e) => ({
    name: e.name,
    category: (e.category ?? deriveCategory(e.name)) as AnalyticsCategory,
    userId: userId ?? null,
    sessionId: session.id,
    platform,
    pageUrl: e.pageUrl ?? null,
    occurredAt: e.occurredAt ? new Date(e.occurredAt) : new Date(),
    properties: {
      ...(e.properties ?? {}),
      // Snapshot the user's identity at write-time. If the user later
      // changes their name/phone, past events still reflect who they
      // were when the event happened — that's the intent.
      ...(userPiiSnapshot ? { user: userPiiSnapshot } : {}),
    },
  }));

  const result = await db.analyticsEvent.createMany({ data: rows });

  return NextResponse.json({
    sessionId: session.id,
    inserted: result.count,
  });
}

// ---------- helpers ----------

interface ResolvedCaller {
  userId: string | null;
  userName: string | null;
  userPhone: string | null;
  platform: string; // "web" | "android" | "ios"
}

async function resolveCaller(request: NextRequest): Promise<ResolvedCaller> {
  // Mobile JWT first — mobile requests carry an Authorization header
  // and a separate "X-Platform: ios|android" hint. We check this
  // BEFORE NextAuth because the mobile app shouldn't ever match a
  // web cookie (different origin), but the early exit shaves a DB
  // call on the hot path for every mobile event batch.
  const mobileUser = await getMobileUser(request);
  if (mobileUser) {
    return {
      userId: mobileUser.id,
      userName: mobileUser.name ?? null,
      userPhone: mobileUser.phone ?? null,
      platform: getMobilePlatform(request),
    };
  }

  // Web NextAuth cookie. Falls through to anonymous if the cookie
  // is missing or invalid.
  const session = await auth().catch(() => null);
  if (session?.user?.id) {
    // PII snapshot — fetch directly because next-auth's User type
    // here only carries id+email, not phone.
    const u = await db.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, phone: true },
    });
    return {
      userId: session.user.id,
      userName: u?.name ?? null,
      userPhone: u?.phone ?? null,
      platform: "web",
    };
  }

  return { userId: null, userName: null, userPhone: null, platform: "web" };
}

interface EnsureSessionInput {
  sessionId: string | undefined;
  userId: string | null;
  platform: string;
  meta?: z.infer<typeof metaSchema>;
}

async function ensureSession(input: EnsureSessionInput) {
  const { sessionId, userId, platform, meta } = input;

  if (sessionId) {
    const existing = await db.analyticsSession.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true },
    });
    if (existing) return existing;
    // Client sent a sessionId we don't have a row for — this happens
    // after a long idle (we'll have purged old sessions, eventually)
    // or if the client's localStorage carried over from another
    // environment. Create a NEW row, intentionally NOT using the
    // client-supplied id — keeps id space monotonic + cuid-shaped.
  }

  const created = await db.analyticsSession.create({
    data: {
      userId: userId ?? null,
      platform,
      utmSource: meta?.utm?.source ?? null,
      utmMedium: meta?.utm?.medium ?? null,
      utmCampaign: meta?.utm?.campaign ?? null,
      utmTerm: meta?.utm?.term ?? null,
      utmContent: meta?.utm?.content ?? null,
      landingPath: meta?.landingPath ?? null,
      referrer: meta?.referrer ?? null,
      uaBrowser: meta?.ua?.browser ?? null,
      uaOs: meta?.ua?.os ?? null,
      uaDevice: meta?.ua?.device ?? null,
      appVersion: meta?.appVersion ?? null,
    },
    select: { id: true, userId: true },
  });
  return created;
}

/**
 * Idempotent — only writes if the user has no cohort yet. Cohort is
 * frozen at the calendar week (Mon-aligned, IST) of first event.
 */
async function ensureUserCohort(userId: string): Promise<void> {
  try {
    const existing = await db.userCohort.findUnique({ where: { userId } });
    if (existing) return;

    const now = new Date();
    // Snap to ISO Monday in IST. Cheap arithmetic — IST is UTC+5:30
    // so we shift by +330 minutes, snap to start-of-day, then back
    // off to Monday. Storing in UTC is fine because we only ever
    // compare snapped values against snapped values.
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffsetMs);
    const istDow = istNow.getUTCDay(); // 0=Sun ... 6=Sat
    const daysSinceMon = (istDow + 6) % 7;
    const cohortWeek = new Date(
      Date.UTC(
        istNow.getUTCFullYear(),
        istNow.getUTCMonth(),
        istNow.getUTCDate() - daysSinceMon,
        0,
        0,
        0,
        0,
      ) - istOffsetMs,
    );
    const cohortMonth = new Date(
      Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1, 0, 0, 0, 0) -
        istOffsetMs,
    );

    await db.userCohort.create({
      data: {
        userId,
        cohortWeek,
        cohortMonth,
        firstSeenAt: now,
      },
    });
  } catch (err) {
    // Race-tolerant: if a parallel request created the row first, the
    // unique constraint trips and we just skip. Log anything else.
    if (
      err instanceof Error &&
      !err.message.includes("Unique constraint")
    ) {
      console.error("[analytics] cohort assign failed for", userId, err);
    }
  }
}

/**
 * Fallback category derivation when the client doesn't send one.
 * The client-side trackXxx() helpers always supply a category, but
 * an SDK-less ad-hoc POST might not — keep the route forgiving.
 */
function deriveCategory(name: string): AnalyticsCategory {
  if (name.startsWith("payment_")) return "PAYMENT" as AnalyticsCategory;
  if (
    name.startsWith("login_") ||
    name.startsWith("otp_") ||
    name.startsWith("signup_")
  ) {
    return "AUTH" as AnalyticsCategory;
  }
  if (name.startsWith("cafe_")) return "CAFE" as AnalyticsCategory;
  if (name.startsWith("waitlist_") || name === "slot_unavailable_tap") {
    return "WAITLIST" as AnalyticsCategory;
  }
  if (name.startsWith("admin_")) return "ADMIN" as AnalyticsCategory;
  if (name.endsWith("_error") || name.endsWith("_failed")) {
    return "ERROR" as AnalyticsCategory;
  }
  if (
    name === "page_view" ||
    name === "tab_switched" ||
    name.startsWith("nav_")
  ) {
    return "NAVIGATION" as AnalyticsCategory;
  }
  if (
    name === "session_started" ||
    name === "session_ended" ||
    name === "app_foreground"
  ) {
    return "SYSTEM" as AnalyticsCategory;
  }
  // Booking is the catch-all — most existing trackXxx() helpers fall
  // here (slot_toggled, sport_selected, proceed_to_checkout_click...).
  return "BOOKING" as AnalyticsCategory;
}
