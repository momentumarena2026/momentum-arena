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
  | "booking_confirmed"
  | "booking_reminder_24h"
  | "booking_reminder_2h"
  | "payment_verified"
  | "refund_processed"
  | "cafe_order_status"
  // Admin-initiated broadcast (manual send from /admin/push). The
  // mobile tap handler treats this as a no-op deep-link — opening
  // the app is enough action.
  | "broadcast";

export interface PushPayload {
  title: string;
  body: string;
  /** All values must be strings — FCM data block is string-only. */
  data: { kind: PushKind } & Record<string, string>;
}

interface SendResult {
  attempted: number;
  succeeded: number;
  failed: number;
  cleanedUp: number;
}

/**
 * Send a push to every registered device for `userId`. Quietly no-ops
 * (logs + returns) if FCM credentials are missing — callers shouldn't
 * have to defensively guard, since push is always best-effort.
 */
export async function sendToUser(
  userId: string,
  payload: PushPayload,
): Promise<SendResult> {
  const devices = await db.pushDevice.findMany({
    where: { userId },
    select: { token: true },
  });
  if (devices.length === 0) {
    return { attempted: 0, succeeded: 0, failed: 0, cleanedUp: 0 };
  }
  return sendToTokens(
    devices.map((d) => d.token),
    payload,
  );
}

/** Lower-level: send to an explicit token list. Used by admin tools / cron. */
export async function sendToTokens(
  tokens: string[],
  payload: PushPayload,
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

  const message = {
    tokens,
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

  const result = await messaging.sendEachForMulticast(message);

  const deadTokens: string[] = [];
  result.responses.forEach((resp, i) => {
    if (resp.success) return;
    const code = resp.error?.code;
    if (
      code === "messaging/registration-token-not-registered" ||
      code === "messaging/invalid-registration-token"
    ) {
      deadTokens.push(tokens[i]);
    } else if (resp.error) {
      console.warn(
        `[push] send failed for token ${tokens[i].slice(0, 12)}…:`,
        resp.error.code,
        resp.error.message,
      );
    }
  });

  let cleanedUp = 0;
  if (deadTokens.length > 0) {
    const del = await db.pushDevice.deleteMany({
      where: { token: { in: deadTokens } },
    });
    cleanedUp = del.count;
  }

  return {
    attempted: tokens.length,
    succeeded: result.successCount,
    failed: result.failureCount,
    cleanedUp,
  };
}
