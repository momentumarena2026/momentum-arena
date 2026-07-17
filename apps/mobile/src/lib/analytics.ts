import { Platform, AppState, type AppStateStatus } from "react-native";
import type { FirebaseAnalyticsTypes } from "@react-native-firebase/analytics";
import { mmkv } from "./storage";
import { env } from "../config/env";
import { tokenStorage } from "./storage";
import { version as appVersion } from "../../package.json";

/**
 * Mobile-side analytics — mirrors lib/analytics.ts on web.
 *
 * Every trackXxx() helper dual-writes, exactly like the web:
 *  1. Google Analytics 4 via Firebase Analytics — release builds of
 *     `main` only (the builds that talk to production), mirroring the
 *     web's "gtag fires only on www.momentumarena.com" gate.
 *  2. First-party Postgres via /api/events — ALL environments.
 *
 * Same trackXxx() naming + event names as web so funnels are
 * platform-agnostic on the server side. Events are queued in MMKV
 * (synchronous, persists across app kills) and flushed in batches
 * to /api/events.
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
  | "REWARDS"
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

// ---------- Google Analytics (GA4 via Firebase Analytics) ----------

/**
 * GA fires only from release builds of `main` — the exact analogue of
 * the web gate (gtag only on www.momentumarena.com). Debug builds and
 * development-branch builds keep GA off so staging traffic never
 * pollutes the production property. First-party events are unaffected.
 */
const GA_ENABLED = env.gitBranch === "main" && !__DEV__;

let gaResolved = false;
let gaInstance: FirebaseAnalyticsTypes.Module | null = null;

/**
 * OTA-SAFETY: this JS ships over-the-air to binaries that may predate
 * the @react-native-firebase/analytics NATIVE module (added alongside
 * this code). Resolve the module lazily inside try/catch — on an old
 * binary GA just stays silently off until the user updates the app;
 * the first-party pipe keeps working either way. Do NOT convert this
 * to a top-level value import.
 */
function getGa(): FirebaseAnalyticsTypes.Module | null {
  if (gaResolved) return gaInstance;
  gaResolved = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("@react-native-firebase/analytics");
    gaInstance = (mod.default as () => FirebaseAnalyticsTypes.Module)();
  } catch {
    gaInstance = null;
  }
  return gaInstance;
}

/** GA4 param values: strings ≤100 chars or numbers. Drop null/undefined. */
function sanitizeGaParams(
  properties?: Record<string, unknown>,
): Record<string, string | number> | undefined {
  if (!properties) return undefined;
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === "boolean") {
      out[key] = String(value);
    } else {
      out[key] = String(value).slice(0, 100);
    }
  }
  return out;
}

function gaLog(name: string, properties?: Record<string, unknown>): void {
  if (!GA_ENABLED) return;
  const ga = getGa();
  if (!ga) return;
  try {
    if (name === "page_view") {
      // Apps use screen_view, not page_view — map our route-change
      // event onto the GA4-native concept so screen reports work.
      const path =
        typeof properties?.path === "string" ? properties.path : "unknown";
      void ga
        .logScreenView({
          screen_name: path.slice(0, 100),
          screen_class: path.slice(0, 100),
        })
        .catch(() => {});
    } else {
      void ga.logEvent(name, sanitizeGaParams(properties)).catch(() => {});
    }
  } catch {
    // RNFB validates event names synchronously — a bad name must never
    // take the first-party pipe down with it.
  }
}

// ---------- Public API: trackEvent + helpers ----------

/**
 * Core dispatcher. Mirrors lib/analytics.ts:trackEvent on web —
 * fires GA4 (production builds only) AND the first-party queue
 * (all environments). The optional category helps the dashboard
 * group events.
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
  gaLog(name, properties);
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
export function trackRecurringToggled(enabled: boolean) {
  trackEvent("recurring_toggled", { enabled }, "BOOKING");
}
export function trackRecurringModeSelected(mode: "weekly" | "daily") {
  trackEvent("recurring_mode_selected", { mode }, "BOOKING");
}
export function trackRecurringDurationSelected(mode: "weekly" | "daily", count: number, discount: number) {
  trackEvent(
    "recurring_duration_selected",
    { mode, count, discount_percent: discount },
    "BOOKING",
  );
}
export function trackProceedToCheckout(slotCount: number, total: number, isRecurring: boolean) {
  trackEvent(
    "proceed_to_checkout_click",
    { slot_count: slotCount, total_amount: total, is_recurring: isRecurring },
    "BOOKING",
  );
}
export function trackCheckoutStarted(bookingId: string, amount: number, sport?: string) {
  trackEvent("checkout_started", { booking_id: bookingId, amount, sport }, "BOOKING");
  // GA4 standard e-commerce: begin_checkout (mirrors web)
  trackEvent("begin_checkout", { currency: "INR", value: amount }, "BOOKING");
}
export function trackBookingConfirmedView(bookingId: string, status: string) {
  trackEvent("booking_confirmed_view", { booking_id: bookingId, status }, "BOOKING");
}
export function trackLockExpired(bookingId: string) {
  trackEvent("lock_expired", { booking_id: bookingId }, "BOOKING");
}
export function trackLockSuccess(bookingId: string) {
  trackEvent("lock_success", { booking_id: bookingId }, "BOOKING");
}
export function trackLockFailed(error: string) {
  trackEvent("lock_failed", { error_message: error }, "BOOKING");
}

// ─── Payment ─────────────────────────────────────────────────────

export function trackPaymentMethodSelected(method: string) {
  trackEvent("payment_method_selected", { method }, "PAYMENT");
  // GA4 standard: add_payment_info (mirrors web)
  trackEvent("add_payment_info", { payment_type: method }, "PAYMENT");
}
export function trackPaymentInitiated(method: string, amount: number, bookingId: string) {
  trackEvent("payment_initiated", { method, amount, booking_id: bookingId }, "PAYMENT");
}
export function trackPaymentCompleted(method: string, amount: number, bookingId: string) {
  trackEvent("payment_completed", { method, amount, booking_id: bookingId }, "PAYMENT");
  // GA4 standard: purchase (mirrors web)
  trackEvent(
    "purchase",
    { currency: "INR", value: amount, transaction_id: bookingId },
    "PAYMENT",
  );
}
export function trackPaymentFailed(method: string, bookingId: string, error?: string) {
  trackEvent("payment_failed", { method, booking_id: bookingId, error }, "PAYMENT");
}
export function trackPaymentCancelled(method: string, bookingId: string) {
  trackEvent("payment_cancelled", { method, booking_id: bookingId }, "PAYMENT");
}

// ─── Discount & coupons ──────────────────────────────────────────

export function trackCouponApplied(code: string, discountAmount: number) {
  trackEvent(
    "coupon_applied",
    { coupon_code: code, discount_amount: discountAmount },
    "PAYMENT",
  );
}
export function trackCouponFailed(code: string, reason?: string) {
  trackEvent("coupon_failed", { coupon_code: code, reason }, "PAYMENT");
}
export function trackNewUserDiscountApplied(discountAmount: number) {
  trackEvent(
    "new_user_discount_applied",
    { discount_amount: discountAmount },
    "PAYMENT",
  );
}

// ─── UPI QR flow ─────────────────────────────────────────────────

export function trackUpiQrShown(amount: number) {
  trackEvent("upi_qr_shown", { amount }, "PAYMENT");
}
export function trackUpiPaymentConfirmed(amount: number) {
  trackEvent("upi_payment_confirmed", { amount }, "PAYMENT");
}
export function trackUpiWhatsappClick(bookingId?: string) {
  trackEvent("upi_whatsapp_screenshot_click", { booking_id: bookingId }, "PAYMENT");
}
/** Fired when the user taps a UPI app in the Razorpay-style sheet —
 *  the app-to-app intent launch (mirrors web's deep-link button). */
export function trackUpiAppLaunched(amount: number) {
  trackEvent("upi_app_launched", { amount }, "PAYMENT");
}

// ─── Monthly passes ──────────────────────────────────────────────
// Mirrors the web pass funnel in lib/analytics.ts so GA4 sees one
// event vocabulary across surfaces.

export function trackPassPurchaseStarted(
  planId: string,
  price: number,
  method: "upi" | "razorpay",
) {
  trackEvent(
    "pass_purchase_started",
    { plan_id: planId, price, method },
    "PAYMENT",
  );
}
export function trackPassPurchaseCompleted(
  planId: string,
  price: number,
  method: "upi" | "razorpay",
) {
  trackEvent(
    "pass_purchase_completed",
    { plan_id: planId, price, method },
    "PAYMENT",
  );
}
export function trackPassRedeemed(
  coveredMinutes: number,
  remainderAmount: number,
) {
  trackEvent(
    "pass_redeemed",
    {
      covered_minutes: coveredMinutes,
      remainder_amount: remainderAmount,
      full_coverage: remainderAmount === 0,
    },
    "PAYMENT",
  );
}
export function trackPassMemberAdded() {
  trackEvent("pass_member_added");
}

// ─── Auth ────────────────────────────────────────────────────────

export function trackLoginModalOpened() {
  trackEvent("login_modal_opened", {}, "AUTH");
}
export function trackLoginPhoneSubmitted() {
  trackEvent("login_phone_submitted", {}, "AUTH");
}
export function trackLoginOtpSubmitted() {
  trackEvent("login_otp_submitted", {}, "AUTH");
}
export function trackLoginSuccess() {
  trackEvent("login_success", {}, "AUTH");
}
export function trackLoginFailed(error: string) {
  trackEvent("login_failed", { error_message: error }, "AUTH");
}
export function trackSignOutClick() {
  trackEvent("sign_out_click", {}, "AUTH");
}

// ─── Waitlist — kept name+arg-shape identical to lib/analytics.ts on web
//                so funnel queries are platform-agnostic.

export function trackSlotUnavailableTap(
  courtConfigId: string,
  hour: number,
  date: string,
  sport: string,
) {
  trackEvent(
    "slot_unavailable_tap",
    { court_config_id: courtConfigId, hour, date, sport },
    "WAITLIST",
  );
}
export function trackWaitlistJoined(
  courtConfigId: string,
  hour: number,
  date: string,
  sport: string,
) {
  trackEvent(
    "waitlist_joined",
    { court_config_id: courtConfigId, hour, date, sport },
    "WAITLIST",
  );
}
export function trackWaitlistJoinFailed(
  courtConfigId: string,
  hour: number,
  reason: string,
) {
  trackEvent(
    "waitlist_join_failed",
    { court_config_id: courtConfigId, hour, reason },
    "WAITLIST",
  );
}
export function trackWaitlistCancelled(waitlistId: string) {
  trackEvent("waitlist_cancelled", { waitlist_id: waitlistId }, "WAITLIST");
}
export function trackWaitlistRowBookNow(waitlistId: string) {
  trackEvent(
    "waitlist_book_now_click",
    { waitlist_id: waitlistId },
    "WAITLIST",
  );
}
/** Fired when the user taps the slot_available push notification. */
export function trackWaitlistNotificationTapped(waitlistId?: string) {
  trackEvent(
    "waitlist_notification_tapped",
    { waitlist_id: waitlistId },
    "WAITLIST",
  );
}

// ─── Cafe — event names + shapes mirror web ──────────────────────

export function trackCafeBrowse() {
  trackEvent("cafe_browse", {}, "CAFE");
}
export function trackCafeItemAdded(itemName: string, price: number) {
  trackEvent("cafe_item_added", { item_name: itemName, price }, "CAFE");
}
export function trackCafeItemRemoved(itemName: string) {
  trackEvent("cafe_item_removed", { item_name: itemName }, "CAFE");
}
export function trackCafeCheckoutStarted(itemCount: number, totalAmount: number) {
  trackEvent(
    "cafe_checkout_started",
    { item_count: itemCount, total_amount: totalAmount },
    "CAFE",
  );
}
export function trackCafePaymentMethodSelected(method: string) {
  trackEvent("cafe_payment_method_selected", { method }, "CAFE");
}
export function trackCafeOrderPlaced(orderId: string, amount: number, method: string) {
  trackEvent(
    "cafe_order_placed",
    { order_id: orderId, amount, payment_method: method },
    "CAFE",
  );
  // GA4 standard: purchase (mirrors web)
  trackEvent(
    "purchase",
    { currency: "INR", value: amount, transaction_id: orderId },
    "CAFE",
  );
}
export function trackCafeOrderConfirmationView(orderId: string) {
  trackEvent("cafe_order_confirmation_view", { order_id: orderId }, "CAFE");
}

// ─── Rewards ─────────────────────────────────────────────────────

/** Fired on RewardsScreen mount — drives the Rewards funnel step 2. */
export function trackRewardsView(pointsAvailable: number) {
  trackEvent(
    "rewards_view",
    { points_available: pointsAvailable },
    "REWARDS",
  );
}

/** Tap on the Momentum Points tile in the Account screen. */
export function trackRewardsTileTap(pointsAvailable: number) {
  trackEvent(
    "rewards_chip_click",
    { source: "account_tile", points_available: pointsAvailable },
    "REWARDS",
  );
}

/** Fired the first time the customer toggles the redemption checkbox
 *  on during a checkout session. Pairs with `rewards_redeem_completed`
 *  for the redemption funnel. Mirrors lib/analytics.ts (web). */
export function trackRewardsRedeemStarted(billPaise: number, maxPoints: number) {
  trackEvent(
    "rewards_redeem_started",
    { bill_paise: billPaise, max_points: maxPoints },
    "REWARDS",
  );
}

/** Fired after a successful redemption commits server-side. */
export function trackRewardsRedeemCompleted(points: number, paiseSaved: number) {
  trackEvent(
    "rewards_redeem_completed",
    { points, paise_saved: paiseSaved },
    "REWARDS",
  );
}

// ─── Home screen — same event names as the web homepage ─────────

export function trackHomepageSportClick(sport: string) {
  trackEvent("homepage_sport_click", { sport }, "NAVIGATION");
}
export function trackHomepageCafeClick() {
  trackEvent("homepage_cafe_click", {}, "NAVIGATION");
}

// ─── Dashboard / account ─────────────────────────────────────────

export function trackDashboardView() {
  trackEvent("dashboard_view", {}, "NAVIGATION");
}
export function trackBookingCardClick(bookingId: string) {
  trackEvent("booking_card_click", { booking_id: bookingId }, "NAVIGATION");
}
export function trackInvoiceDownload(bookingId: string) {
  trackEvent("invoice_download", { booking_id: bookingId }, "NAVIGATION");
}

// ─── Chat / support ──────────────────────────────────────────────

export function trackChatWidgetOpened() {
  trackEvent("chat_widget_opened", {}, "NAVIGATION");
}
export function trackChatMessageSent() {
  trackEvent("chat_message_sent", {}, "NAVIGATION");
}

// ─── Errors ──────────────────────────────────────────────────────

export function trackError(errorType: string, message: string) {
  trackEvent(
    "app_error",
    { error_type: errorType, error_message: message },
    "ERROR",
  );
}

// ─── Navigation / system ─────────────────────────────────────────

/** Route-change event. On GA this maps to the native screen_view
 *  (see gaLog) so Firebase screen reports work out of the box.
 *  Wired once in RootNavigator — don't call from feature code. */
export function trackPageView(path: string) {
  trackEvent("page_view", { path }, "NAVIGATION");
}
/** Bottom-tab tap — same event name as the web bottom nav. */
export function trackBottomNavClick(tab: string) {
  trackEvent("bottom_nav_click", { tab }, "NAVIGATION");
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

  // Keep Firebase's automatic collection (first_open, session_start,
  // user_engagement …) aligned with the same production-only gate our
  // manual events use, so dev/staging builds send nothing to GA.
  const ga = getGa();
  if (ga) {
    void ga.setAnalyticsCollectionEnabled(GA_ENABLED).catch(() => {});
  }

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
