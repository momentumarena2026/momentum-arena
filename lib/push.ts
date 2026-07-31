import { db } from "@/lib/db";

/**
 * Server-side push notifications via Firebase Admin SDK / FCM.
 *
 * Init is lazy so a missing `FIREBASE_SERVICE_ACCOUNT_JSON` env var
 * doesn't crash the Vercel build — it only throws if/when we actually
 * try to send. That way local dev (and previews without the secret)
 * keep working; only production paths that fan out to mobile devices
 * exercise this code.
 *
 * Send shape:
 *   - `notification: { title, body }` → OS displays a banner.
 *   - `data: { kind, bookingId, ... }` → string-only key-value the
 *      mobile app reads in `onNotificationOpenedApp` /
 *      `getInitialNotification` to route the user to the right
 *      screen on tap.
 *
 * Dead token cleanup: FCM returns
 * `messaging/registration-token-not-registered` for tokens belonging
 * to uninstalled apps, signed-out users on another device, or tokens
 * that have rotated. We delete those rows so we don't keep paying for
 * sends that go nowhere.
 */

import type { Messaging } from "firebase-admin/messaging";

let cachedMessaging: Messaging | null = null;

/** FCM's hard cap on tokens per `sendEachForMulticast` call. */
const FCM_MULTICAST_LIMIT = 500;

async function getMessaging(): Promise<Messaging> {
  if (cachedMessaging) return cachedMessaging;

  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!json) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is not set — push notifications are not configured",
    );
  }

  // Dynamic imports so the firebase-admin bundle isn't pulled into
  // routes that never push (every server action transitively imports
  // lib/db, which used to import lib/notifications, which now imports
  // this).
  const [{ initializeApp, getApps, cert }, { getMessaging: getMsg }] =
    await Promise.all([
      import("firebase-admin/app"),
      import("firebase-admin/messaging"),
    ]);

  if (!getApps().length) {
    let serviceAccount: Record<string, unknown>;
    try {
      serviceAccount = JSON.parse(json);
    } catch (err) {
      throw new Error(
        `FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    initializeApp({
      credential: cert(serviceAccount as Parameters<typeof cert>[0]),
    });
  }

  cachedMessaging = getMsg();
  return cachedMessaging;
}

/** Discriminated union of every push payload kind the app handles. */
export type PushKind =
  // Customer-bound kinds — sent to PushDevice rows.
  | "booking_confirmed"
  | "booking_reminder_24h"
  | "booking_reminder_2h"
  | "booking_reminder_1h"
  | "booking_cancelled"
  | "payment_verified"
  | "refund_processed"
  | "cafe_order_status"
  // A slot the user joined the waitlist for has just opened up
  // (someone else cancelled / refunded / had their slots edited
  // off). Mobile tap handler routes to the user's waitlist screen
  // so they can book in one tap.
  | "slot_available"
  // Reward earn events — booking, cafe, manual admin grant, signup
  // bonus, etc. The mobile tap handler deep-links to RewardsScreen.
  // data block includes `points` (string) and the source `txnType`.
  | "rewards_earned"
  // Admin-initiated broadcast (manual send from /admin/push). The
  // mobile tap handler treats this as a no-op deep-link — opening
  // the app is enough action.
  | "broadcast"
  // Admin broadcast targeting an in-app screen (data.screen =
  // home|book|cafe|shop|rewards); the mobile tap handler routes to
  // that tab. Set by the broadcast form's "On tap, open" picker.
  | "open_screen"
  // In-app notification mirror (lib/user-notifications.ts) — the row is
  // the source of truth; this push just surfaces it. The mobile tap
  // handler routes to the Notifications screen.
  | "in_app"
  // Admin-bound kinds — sent to AdminPushDevice rows. The mobile
  // admin shell routes taps to the booking detail or unconfirmed
  // queue accordingly.
  | "admin_pending_booking"
  | "admin_booking_confirmed"
  | "admin_booking_cancelled";

export interface PushPayload {
  title: string;
  body: string;
  /** All values must be strings — FCM data block is string-only. */
  data: { kind: PushKind } & Record<string, string>;
}

export interface SendResult {
  attempted: number;
  succeeded: number;
  failed: number;
  cleanedUp: number;
}

/**
 * Optional context recorded with each send for the Push Analytics
 * dashboard. Events (booking/cafe/rewards/...) get sensible defaults;
 * broadcasts + test pushes pass richer context (audience, who sent it).
 */
export interface DispatchMeta {
  scope?: "customer" | "admin";
  source?: "event" | "broadcast" | "test";
  sentByAdminId?: string | null;
  audience?: string | null;
}

// Best-effort: record one row per dispatch for analytics. Never throws —
// a logging failure must not break the (already best-effort) send.
async function logDispatch(
  payload: PushPayload,
  result: SendResult,
  meta: DispatchMeta,
): Promise<void> {
  try {
    await db.pushDispatch.create({
      data: {
        kind: payload.data.kind,
        scope: meta.scope ?? "customer",
        source: meta.source ?? "event",
        audience: meta.audience ?? null,
        sentByAdminId: meta.sentByAdminId ?? null,
        title: payload.title.slice(0, 200),
        body: payload.body.slice(0, 500),
        attempted: result.attempted,
        succeeded: result.succeeded,
        failed: result.failed,
        cleanedUp: result.cleanedUp,
      },
    });
  } catch (err) {
    console.warn(
      "[push] failed to log dispatch:",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Send a push to every registered device for `userId`. Quietly no-ops
 * (logs + returns) if FCM credentials are missing — callers shouldn't
 * have to defensively guard, since push is always best-effort.
 */
export async function sendToUser(
  userId: string,
  payload: PushPayload,
  meta: DispatchMeta = {},
): Promise<SendResult> {
  const devices = await db.pushDevice.findMany({
    where: { userId },
    select: { token: true },
  });
  if (devices.length === 0) {
    return { attempted: 0, succeeded: 0, failed: 0, cleanedUp: 0 };
  }
  return sendToTokens(devices.map((d) => d.token), payload, {
    scope: "customer",
    source: "event",
    ...meta,
  });
}

/**
 * Fan out a push to every admin device. Use this for any
 * booking-team alert that should hit the floor staff (new booking,
 * pending verification queue, cancellations, etc.) — never to
 * customer phones.
 *
 * The query is intentionally unfiltered by AdminUser.permissions or
 * .role because the venue's admin team is small and they all care
 * about the same booking events. If we ever scale to multi-venue or
 * specialized roles, add a `permissionFilter` argument and a join.
 */
export async function sendToAdmins(
  payload: PushPayload,
  meta: DispatchMeta = {},
): Promise<SendResult> {
  const devices = await db.adminPushDevice.findMany({
    select: { token: true },
  });
  if (devices.length === 0) {
    return { attempted: 0, succeeded: 0, failed: 0, cleanedUp: 0 };
  }
  return sendToTokens(devices.map((d) => d.token), payload, {
    scope: "admin",
    source: "event",
    ...meta,
  });
}

/** Lower-level: send to an explicit token list. Used by admin tools / cron. */
export async function sendToTokens(
  tokens: string[],
  payload: PushPayload,
  meta: DispatchMeta = {},
): Promise<SendResult> {
  if (tokens.length === 0) {
    return { attempted: 0, succeeded: 0, failed: 0, cleanedUp: 0 };
  }

  let messaging: Messaging;
  try {
    messaging = await getMessaging();
  } catch (err) {
    console.warn(
      "[push] FCM not configured — skipping send:",
      err instanceof Error ? err.message : err,
    );
    return { attempted: tokens.length, succeeded: 0, failed: tokens.length, cleanedUp: 0 };
  }

  const baseMessage = {
    notification: { title: payload.title, body: payload.body },
    data: payload.data,
    // iOS-side: ensure the OS treats it as a normal alert.
    apns: {
      payload: {
        aps: { sound: "default", contentAvailable: true },
      },
    },
    // Android-side: high priority so it pops on the lockscreen for
    // time-sensitive booking reminders.
    android: { priority: "high" as const, notification: { sound: "default" } },
  };

  const deadTokens: string[] = [];
  let succeeded = 0;
  let failed = 0;

  // FCM rejects a multicast of more than 500 tokens by throwing *before*
  // dispatching any of them, so a single oversized call would drop the
  // whole broadcast rather than just the overflow. Fan out in batches.
  for (let offset = 0; offset < tokens.length; offset += FCM_MULTICAST_LIMIT) {
    const batch = tokens.slice(offset, offset + FCM_MULTICAST_LIMIT);
    const result = await messaging.sendEachForMulticast({
      ...baseMessage,
      tokens: batch,
    });

    succeeded += result.successCount;
    failed += result.failureCount;

    result.responses.forEach((resp, i) => {
      if (resp.success) return;
      const code = resp.error?.code;
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      ) {
        deadTokens.push(batch[i]);
      } else if (resp.error) {
        console.warn(
          `[push] send failed for token ${batch[i].slice(0, 12)}…:`,
          resp.error.code,
          resp.error.message,
        );
      }
    });
  }

  let cleanedUp = 0;
  if (deadTokens.length > 0) {
    // Dead tokens can live in either PushDevice (customer) or
    // AdminPushDevice (admin) — and the same FCM token can appear
    // in both when a staffer is signed in to both surfaces on one
    // device. Wipe from both so subsequent fan-outs don't re-hit
    // the dead row from the other table.
    const [customerDel, adminDel] = await Promise.all([
      db.pushDevice.deleteMany({ where: { token: { in: deadTokens } } }),
      db.adminPushDevice.deleteMany({ where: { token: { in: deadTokens } } }),
    ]);
    cleanedUp = customerDel.count + adminDel.count;
  }

  const sendResult: SendResult = {
    attempted: tokens.length,
    succeeded,
    failed,
    cleanedUp,
  };
  await logDispatch(payload, sendResult, meta);
  return sendResult;
}
