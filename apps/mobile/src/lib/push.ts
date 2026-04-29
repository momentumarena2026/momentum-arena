import { Platform, PermissionsAndroid } from "react-native";
import messaging, {
  type FirebaseMessagingTypes,
} from "@react-native-firebase/messaging";
import { api, ApiError } from "./api";
import { request as adminApiRequest, AdminApiError } from "./admin-api";

/**
 * Mobile-side push notifications wiring.
 *
 * Lifecycle, top-down:
 *   1. After sign-in:       `enablePushAfterLogin()`
 *      → asks for permission (iOS + Android 13+) and, if granted,
 *        fetches the FCM token and posts it to /api/mobile/devices.
 *      → also subscribes to onTokenRefresh so a rotated token
 *        re-registers automatically.
 *   2. Before sign-out:     `disablePushBeforeLogout()`
 *      → DELETE /api/mobile/devices for the current token so the
 *        signed-out device stops receiving pushes for the previous
 *        owner.
 *   3. App-wide:            `installPushTapHandlers(onTap)`
 *      → registers cold-start (`getInitialNotification`) +
 *        background-tap (`onNotificationOpenedApp`) listeners and
 *        forwards parsed payloads to `onTap` for navigation.
 *
 * Foreground messages: by default FCM does NOT show a notification
 * banner when the app is in the foreground. We don't render an
 * in-app toast yet — that's a v2 polish (would use Notifee). For now
 * a foreground push silently invalidates the relevant TanStack Query
 * cache via `onTap` semantics if needed.
 */

const DEVICES_ENDPOINT = "/api/mobile/devices";
const ADMIN_DEVICES_ENDPOINT = "/api/mobile/admin/devices";

export type PushKind =
  | "booking_confirmed"
  | "booking_reminder_24h"
  | "booking_reminder_2h"
  | "booking_reminder_1h"
  | "booking_cancelled"
  | "payment_verified"
  | "refund_processed"
  | "cafe_order_status"
  | "broadcast"
  // Admin-bound — only delivered to AdminPushDevice rows server-side.
  | "admin_pending_booking"
  | "admin_booking_confirmed"
  | "admin_booking_cancelled";

export interface PushTapPayload {
  kind: PushKind;
  bookingId?: string;
  cafeOrderId?: string;
  raw: Record<string, string>;
}

// Two independent lifecycles — customer auth and admin auth can be
// signed in and out on the same device independently. We keep
// separate caches/unsubscribes so each side owns its own token-
// refresh loop and doesn't accidentally clear the other when an
// admin signs out (or vice versa).
let unsubscribeTokenRefresh: (() => void) | null = null;
let cachedToken: string | null = null;

let unsubscribeAdminTokenRefresh: (() => void) | null = null;
let cachedAdminToken: string | null = null;

/**
 * Ask the OS for permission to display notifications. iOS uses the
 * native prompt; Android 13+ uses POST_NOTIFICATIONS at runtime; on
 * older Android the permission is granted at install time so the
 * call resolves immediately.
 */
async function requestPermission(): Promise<boolean> {
  if (Platform.OS === "ios") {
    const status = await messaging().requestPermission();
    return (
      status === messaging.AuthorizationStatus.AUTHORIZED ||
      status === messaging.AuthorizationStatus.PROVISIONAL
    );
  }

  if (Platform.OS === "android") {
    // PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS isn't typed
    // on RN < 0.71 SDKs but exists at runtime on Android 13+. Cast
    // through unknown to avoid a TS error without disabling the
    // checker for the whole file.
    const permission =
      (PermissionsAndroid.PERMISSIONS as unknown as { POST_NOTIFICATIONS?: string })
        .POST_NOTIFICATIONS;
    if (!permission) return true; // pre-Android-13 — implicit grant
    const result = await PermissionsAndroid.request(
      permission as Parameters<typeof PermissionsAndroid.request>[0],
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }

  return false;
}

async function registerTokenWithBackend(token: string): Promise<void> {
  await api.post(DEVICES_ENDPOINT, {
    token,
    platform: Platform.OS === "ios" ? "ios" : "android",
  });
  cachedToken = token;
}

/**
 * Call after the user is signed in. Idempotent — safe to call on
 * every cold start once you've checked auth state.
 */
export async function enablePushAfterLogin(): Promise<void> {
  try {
    const granted = await requestPermission();
    if (!granted) return;

    const token = await messaging().getToken();
    if (token) {
      await registerTokenWithBackend(token);
    }

    // Re-register on rotation. messaging().onTokenRefresh returns
    // an unsubscribe; stash it so logout can clean up.
    unsubscribeTokenRefresh?.();
    unsubscribeTokenRefresh = messaging().onTokenRefresh(async (newToken) => {
      try {
        await registerTokenWithBackend(newToken);
      } catch (err) {
        // Don't crash the app if the backend is unreachable — FCM
        // will retain the token and we'll re-register next launch.
        console.warn("[push] token refresh registration failed:", err);
      }
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    console.warn("[push] enablePushAfterLogin failed:", err);
  }
}

/**
 * Admin equivalent of `enablePushAfterLogin`. Wires the same FCM
 * token to /api/mobile/admin/devices via the admin bearer auth.
 *
 * Call after admin sign-in (and on cold-start once the admin auth
 * provider hydrates a signed-in state) so the device starts
 * receiving floor-staff alerts: new bookings, the unconfirmed
 * verification queue, cancellations.
 *
 * Idempotent. Permission prompt is reused — if the customer side
 * already asked, the OS won't re-prompt.
 */
export async function enableAdminPushAfterLogin(): Promise<void> {
  try {
    const granted = await requestPermission();
    if (!granted) return;

    const token = await messaging().getToken();
    if (token) {
      await adminApiRequest(ADMIN_DEVICES_ENDPOINT, {
        method: "POST",
        body: {
          token,
          platform: Platform.OS === "ios" ? "ios" : "android",
        },
      });
      cachedAdminToken = token;
    }

    unsubscribeAdminTokenRefresh?.();
    unsubscribeAdminTokenRefresh = messaging().onTokenRefresh(
      async (newToken) => {
        try {
          await adminApiRequest(ADMIN_DEVICES_ENDPOINT, {
            method: "POST",
            body: {
              token: newToken,
              platform: Platform.OS === "ios" ? "ios" : "android",
            },
          });
          cachedAdminToken = newToken;
        } catch (err) {
          console.warn(
            "[push:admin] token refresh registration failed:",
            err,
          );
        }
      },
    );
  } catch (err) {
    if (err instanceof AdminApiError && err.status === 401) return;
    console.warn("[push:admin] enableAdminPushAfterLogin failed:", err);
  }
}

/** Admin equivalent of `disablePushBeforeLogout`. */
export async function disableAdminPushBeforeLogout(): Promise<void> {
  unsubscribeAdminTokenRefresh?.();
  unsubscribeAdminTokenRefresh = null;

  const token =
    cachedAdminToken ?? (await messaging().getToken().catch(() => null));
  cachedAdminToken = null;
  if (!token) return;

  try {
    await adminApiRequest(ADMIN_DEVICES_ENDPOINT, {
      method: "DELETE",
      body: { token },
    });
  } catch (err) {
    // Best-effort. Server-side dead-token cleanup catches stragglers
    // when FCM next reports the token isn't registered.
    console.warn("[push:admin] disableAdminPushBeforeLogout failed:", err);
  }
}

/**
 * Call before signing the user out (or right after, if you'd rather
 * not block the sign-out flow). Removes the current device from the
 * backend so the *previous* owner doesn't receive pushes meant for
 * a different account on a shared device.
 */
export async function disablePushBeforeLogout(): Promise<void> {
  unsubscribeTokenRefresh?.();
  unsubscribeTokenRefresh = null;

  const token = cachedToken ?? (await messaging().getToken().catch(() => null));
  cachedToken = null;
  if (!token) return;

  try {
    await api.delete(DEVICES_ENDPOINT, { body: { token } });
  } catch (err) {
    // Best-effort. If we can't reach the API, the dead-token cleanup
    // path on the server will eventually drop the row when an FCM
    // send returns `registration-token-not-registered`.
    console.warn("[push] disablePushBeforeLogout failed:", err);
  }
}

function parseTapPayload(
  msg: FirebaseMessagingTypes.RemoteMessage | null,
): PushTapPayload | null {
  if (!msg?.data) return null;
  const data = msg.data as Record<string, string>;
  const kind = data.kind as PushKind | undefined;
  if (!kind) return null;
  return {
    kind,
    bookingId: data.bookingId,
    cafeOrderId: data.cafeOrderId,
    raw: data,
  };
}

/**
 * Wire cold-start + background-tap handlers. Call once from
 * `App.tsx` (or somewhere it'll only run once per process).
 *
 * Returns an unsubscribe function for the background handler. The
 * cold-start handler is one-shot, no cleanup needed.
 */
export function installPushTapHandlers(
  onTap: (payload: PushTapPayload) => void,
): () => void {
  // Cold start (app was killed). Resolves once at startup.
  messaging()
    .getInitialNotification()
    .then((msg) => {
      const parsed = parseTapPayload(msg);
      if (parsed) onTap(parsed);
    })
    .catch(() => {
      /* getInitialNotification never throws in normal use — swallow defensively */
    });

  // Background → foreground tap (app was suspended).
  return messaging().onNotificationOpenedApp((msg) => {
    const parsed = parseTapPayload(msg);
    if (parsed) onTap(parsed);
  });
}
