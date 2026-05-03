import { Platform, AppState, type AppStateStatus } from "react-native";
import { mmkv } from "./storage";
import { env } from "../config/env";
import { tokenStorage } from "./storage";
import { version as appVersion } from "../../package.json";

/**
 * Mobile-side first-party analytics — mirrors lib/analytics.ts on web.
 *
 * Same trackXxx() naming so funnels are platform-agnostic on the
 * server side. Events are queued in MMKV (synchronous, persists
 * across app kills) and flushed in batches to /api/events.
 *
 * Lifecycle:
 *   - Auto-flush on app foreground (background→active transition).
 *   - Auto-flush every 30s while in foreground.
 *   - Auto-flush on batch size 20.
 *   - Manual flush() after sign-in / before sign-out so the auth
 *     event lands attributed to the right user.
 *
 * Anti-patterns to avoid:
 *   - Don't queueEvent() from feature code — go through the typed
 *     trackXxx() helpers below so event names stay grep-able.
 *   - Never log raw PII (phone/email) in the properties block — the
 *     server snapshots user.name + user.phone automatically when the
 *     caller is authenticated.
 */

const QUEUE_KEY = "analytics.queue";
const SESSION_ID_KEY = "analytics.sessionId";
const META_SENT_KEY = "analytics.metaSent";

const FLUSH_INTERVAL_MS = 30_000;
const FLUSH_BATCH_SIZE = 20;
const MAX_QUEUE_SIZE = 500; // hard cap so a long offline stretch can't blow up memory

type EventCategory =
  | "BOOKING"
  | "PAYMENT"
  | "AUTH"
  | "CAFE"
  | "WAITLIST"
  | "NAVIGATION"
  | "ADMIN"
  | "ERROR"
  | "SYSTEM";

interface QueuedEvent {
  name: string;
  category?: EventCategory;
  properties?: Record<string, unknown>;
  occurredAt: string;
}

let flushTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;
let initialized = false;

// ---------- Public API: trackEvent + helpers ----------

/**
 * Core dispatcher. Mirrors lib/analytics.ts:trackEvent on web —
 * includes an optional category that helps the dashboard group events.
 */
export function trackEvent(
  name: string,
  properties?: Record<string, unknown>,
  category?: EventCategory,
): void {
  ensureInitialized();
  enqueue({
    name,
    category,
    properties: properties
      ? Object.fromEntries(
          Object.entries(properties).filter(([, v]) => v !== undefined),
        )
      : undefined,
    occurredAt: new Date().toISOString(),
  });
}

// ─── Booking funnel — mirrors web ────────────────────────────────

export function trackSportSelected(sport: string) {
  trackEvent("sport_selected", { sport }, "BOOKING");
}
export function trackCourtConfigSelected(sport: string, configId: string, label: string) {
  trackEvent(
    "court_config_selected",
    { sport, config_id: configId, court_label: label },
    "BOOKING",
  );
}
export function trackSlotToggled(action: "add" | "remove", hour: number, price: number) {
  trackEvent("slot_toggled", { action, hour, price }, "BOOKING");
}
export function trackDateChanged(date: string) {
  trackEvent("date_changed", { date }, "BOOKING");
}
export function trackProceedToCheckout(slotCount: number, total: number) {
  trackEvent(
    "proceed_to_checkout_click",
    { slot_count: slotCount, total_amount: total, is_recurring: false },
    "BOOKING",
  );
}
export function trackCheckoutStarted(bookingId: string, amount: number, sport?: string) {
  trackEvent("checkout_started", { booking_id: bookingId, amount, sport }, "BOOKING");
}
export function trackBookingConfirmedView(bookingId: string, status: string) {
  trackEvent("booking_confirmed_view", { booking_id: bookingId, status }, "BOOKING");
}

// ─── Payment ─────────────────────────────────────────────────────

export function trackPaymentInitiated(method: string, amount: number, bookingId: string) {
  trackEvent("payment_initiated", { method, amount, booking_id: bookingId }, "PAYMENT");
}
export function trackPaymentCompleted(method: string, amount: number, bookingId: string) {
  trackEvent("payment_completed", { method, amount, booking_id: bookingId }, "PAYMENT");
}
export function trackPaymentFailed(method: string, bookingId: string, error?: string) {
  trackEvent("payment_failed", { method, booking_id: bookingId, error }, "PAYMENT");
}

// ─── Auth ────────────────────────────────────────────────────────

export function trackPhoneSubmitted() {
  trackEvent("login_phone_submitted", {}, "AUTH");
}
export function trackOtpSubmitted() {
  trackEvent("login_otp_submitted", {}, "AUTH");
}
export function trackLoginSuccess() {
  trackEvent("login_success", {}, "AUTH");
}
export function trackSignOutClick() {
  trackEvent("sign_out_click", {}, "AUTH");
}

// ─── Waitlist ────────────────────────────────────────────────────

export function trackSlotUnavailableTap(courtConfigId: string, hour: number, date: string) {
  trackEvent(
    "slot_unavailable_tap",
    { court_config_id: courtConfigId, hour, date },
    "WAITLIST",
  );
}
export function trackWaitlistJoined(courtConfigId: string, hour: number, date: string) {
  trackEvent(
    "waitlist_joined",
    { court_config_id: courtConfigId, hour, date },
    "WAITLIST",
  );
}
export function trackWaitlistTapped(waitlistId: string) {
  trackEvent("waitlist_notification_tapped", { waitlist_id: waitlistId }, "WAITLIST");
}

// ─── Cafe ────────────────────────────────────────────────────────

export function trackCafeBrowse() {
  trackEvent("cafe_browse", {}, "CAFE");
}
export function trackCafeItemAdded(itemId: string, price: number) {
  trackEvent("cafe_item_added", { item_id: itemId, price }, "CAFE");
}
export function trackCafeCheckout(amount: number) {
  trackEvent("cafe_checkout", { amount }, "CAFE");
}
export function trackCafePaymentCompleted(orderId: string, amount: number) {
  trackEvent(
    "cafe_payment_completed",
    { order_id: orderId, amount },
    "PAYMENT",
  );
}

// ─── Navigation / system ─────────────────────────────────────────

export function trackPageView(path: string) {
  trackEvent("page_view", { path }, "NAVIGATION");
}
export function trackTabSwitched(to: string) {
  trackEvent("tab_switched", { to }, "NAVIGATION");
}
export function trackAppForeground() {
  trackEvent("app_foreground", {}, "SYSTEM");
}

// ---------- Lifecycle: init, flush, sign-in/out ----------

/**
 * Call once from App.tsx (top-level mount). Idempotent — safe to call
 * on every cold start.
 */
export function initAnalytics(): void {
  if (initialized) return;
  ensureInitialized();
}

/**
 * Manually drain the queue. Awaits the network — useful right after
 * sign-in (so the next batch is attributed to the new user) and right
 * before sign-out (so the sign_out event itself is attributed to the
 * OUTGOING user before we rotate the session).
 */
export async function flushAnalytics(): Promise<void> {
  await flushOnce();
}

/**
 * Call from the sign-out flow. Drops the cached session id so the
 * next user on the same device gets a fresh AnalyticsSession row.
 */
export function rotateAnalyticsSession(): void {
  mmkv.delete(SESSION_ID_KEY);
  mmkv.delete(META_SENT_KEY);
}

// ---------- Internals ----------

function ensureInitialized(): void {
  if (initialized) return;
  initialized = true;

  // Foreground/background lifecycle. Flush on transition to active
  // because that's the user-visible point at which any queued events
  // from the previous session-segment should land.
  appStateSub = AppState.addEventListener("change", (next: AppStateStatus) => {
    if (next === "active") {
      trackAppForeground();
      void flushOnce();
    } else if (next === "background") {
      // Best-effort flush before backgrounding. RN doesn't give us a
      // reliable "we're really going away now" hook so we just fire
      // and accept the request may not finish if the OS suspends us.
      void flushOnce();
    }
  });

  if (flushTimer) clearInterval(flushTimer);
  flushTimer = setInterval(() => {
    void flushOnce();
  }, FLUSH_INTERVAL_MS);
}

function enqueue(event: QueuedEvent): void {
  const queue = readQueue();
  queue.push(event);
  // Hard cap — drop oldest if we're over. Better than letting the
  // queue grow unboundedly during a long offline stretch.
  if (queue.length > MAX_QUEUE_SIZE) {
    queue.splice(0, queue.length - MAX_QUEUE_SIZE);
  }
  writeQueue(queue);

  if (queue.length >= FLUSH_BATCH_SIZE) {
    void flushOnce();
  }
}

function readQueue(): QueuedEvent[] {
  const raw = mmkv.getString(QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueuedEvent[];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedEvent[]): void {
  if (queue.length === 0) {
    mmkv.delete(QUEUE_KEY);
  } else {
    mmkv.set(QUEUE_KEY, JSON.stringify(queue));
  }
}

let flushInFlight: Promise<void> | null = null;

async function flushOnce(): Promise<void> {
  // Coalesce concurrent flush requests — one in-flight at a time so
  // we don't race-double-post the same events.
  if (flushInFlight) return flushInFlight;

  flushInFlight = (async () => {
    try {
      const queue = readQueue();
      if (queue.length === 0) return;

      // Snapshot + clear queue BEFORE sending. If the request fails
      // we re-prepend (see catch). This avoids double-flushing events
      // queued while the request is in flight.
      writeQueue([]);

      const sessionId = mmkv.getString(SESSION_ID_KEY);
      const metaSent = mmkv.getBoolean(META_SENT_KEY) === true;

      const body = {
        sessionId: sessionId ?? undefined,
        events: queue,
        meta: metaSent ? undefined : buildSessionMeta(),
      };

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Platform": Platform.OS === "ios" ? "ios" : "android",
      };
      const token = await tokenStorage.read();
      if (token) headers.Authorization = `Bearer ${token}`;

      try {
        const res = await fetch(`${env.apiUrl}/api/events`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const json = (await res.json()) as { sessionId?: string };
          if (json.sessionId && json.sessionId !== sessionId) {
            mmkv.set(SESSION_ID_KEY, json.sessionId);
          }
          mmkv.set(META_SENT_KEY, true);
        } else {
          // Re-prepend so we retry on next flush. Keep behind the
          // hard cap.
          const merged = [...queue, ...readQueue()].slice(-MAX_QUEUE_SIZE);
          writeQueue(merged);
          if (__DEV__) {
            console.warn("[analytics] flush HTTP", res.status);
          }
        }
      } catch (err) {
        const merged = [...queue, ...readQueue()].slice(-MAX_QUEUE_SIZE);
        writeQueue(merged);
        if (__DEV__) {
          console.warn("[analytics] flush network", err);
        }
      }
    } finally {
      flushInFlight = null;
    }
  })();
  return flushInFlight;
}

function buildSessionMeta() {
  return {
    appVersion,
    ua: {
      os: Platform.OS === "ios" ? "iOS" : "Android",
      device: "mobile",
    },
  };
}
