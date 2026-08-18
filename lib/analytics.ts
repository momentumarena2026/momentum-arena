/**
 * Event tracking utilities — dual-writes to:
 *  1. Google Analytics 4 (production domain only — kept as a parallel
 *     pipe during the v1 rollout of our first-party analytics; will
 *     be removed once dashboards reach parity).
 *  2. First-party Postgres via /api/events (all environments).
 *
 * Source of truth for event names + properties. Every CTA / funnel
 * call site goes through one of the typed helpers below — keep them
 * grep-able (snake_case names, descriptive helpers).
 */

import { queueEvent } from "./analytics-session";

type GtagParams = Record<string, string | number | boolean | undefined>;

const GA_MEASUREMENT_ID = "G-JV1973H52L";
const PRODUCTION_HOST = "www.momentumarena.com";

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

/**
 * Core event dispatcher.
 *
 * Fires the event into BOTH:
 *   - GA4 (production-domain only — preserves existing GA setup)
 *   - First-party /api/events queue (all environments, including dev)
 *
 * The second arg form `(name, params)` keeps existing call sites
 * working unchanged — none of the 30+ trackXxx() helpers below need
 * to be touched. The optional `category` overload lets new helpers
 * tag events properly so the dashboard can group them.
 */
export function trackEvent(
  eventName: string,
  params?: GtagParams,
  category?: EventCategory,
) {
  // 1) GA4 — same behavior as before. Production-domain only.
  if (typeof window !== "undefined" && window.location.hostname === PRODUCTION_HOST && window.gtag) {
    window.gtag("event", eventName, params);
  }

  // 2) First-party — all environments. The queue is debounced + batched
  // so a flurry of trackXxx() calls produces one network roundtrip.
  // Sanitize undefined values before posting (JSON would drop them
  // silently anyway, but keep the wire payload tidy).
  if (typeof window !== "undefined") {
    const properties = params
      ? Object.fromEntries(
          Object.entries(params).filter(([, v]) => v !== undefined),
        )
      : undefined;
    queueEvent({ name: eventName, properties, category });
  }
}

// ─── App download ─────────────────────────────────────────────────

/**
 * A tap on a "get the app" badge. `placement` distinguishes the header
 * icon from the footer badge and the sticky bar, so we can tell which
 * surface actually earns installs rather than only that some did.
 *
 * NAVIGATION rather than a new category: this is a link out of the site,
 * the same family as deep_link_opened.
 */
export function trackDownloadAppClick(
  store: "ios" | "android",
  placement: "header" | "footer" | "sticky_bar" | "other",
) {
  trackEvent("download_app_click", { store, placement }, "NAVIGATION");
}

// ─── Booking Funnel ───────────────────────────────────────────────

export function trackSportSelected(sport: string) {
  trackEvent("sport_selected", { sport });
}

export function trackCourtConfigSelected(sport: string, configId: string, label: string) {
  trackEvent("court_config_selected", { sport, config_id: configId, court_label: label });
}

export function trackSlotToggled(action: "add" | "remove", hour: number, price: number) {
  trackEvent("slot_toggled", { action, hour, price });
}

export function trackDateChanged(date: string) {
  trackEvent("date_changed", { date });
}

export function trackRecurringToggled(enabled: boolean) {
  trackEvent("recurring_toggled", { enabled });
}

export function trackRecurringModeSelected(mode: "weekly" | "daily") {
  trackEvent("recurring_mode_selected", { mode });
}

export function trackRecurringDurationSelected(mode: "weekly" | "daily", count: number, discount: number) {
  trackEvent("recurring_duration_selected", { mode, count, discount_percent: discount });
}

export function trackProceedToCheckout(slotCount: number, total: number, isRecurring: boolean) {
  trackEvent("proceed_to_checkout_click", {
    slot_count: slotCount,
    total_amount: total,
    is_recurring: isRecurring,
  });
}

export function trackCheckoutStarted(bookingId: string, amount: number, sport?: string) {
  trackEvent("checkout_started", { booking_id: bookingId, amount, sport: sport || "" });
  // GA4 standard e-commerce: begin_checkout
  trackEvent("begin_checkout", {
    currency: "INR",
    value: amount,
  });
}

export function trackPaymentMethodSelected(method: string) {
  trackEvent("payment_method_selected", { method });
  // GA4 standard: add_payment_info
  trackEvent("add_payment_info", { payment_type: method });
}

export function trackPaymentInitiated(method: string, amount: number, bookingId: string) {
  trackEvent("payment_initiated", { method, amount, booking_id: bookingId });
}

export function trackPaymentCompleted(method: string, amount: number, bookingId: string) {
  trackEvent("payment_completed", { method, amount, booking_id: bookingId });
  // GA4 standard: purchase
  trackEvent("purchase", {
    currency: "INR",
    value: amount,
    transaction_id: bookingId,
  });
}

export function trackPaymentFailed(method: string, bookingId: string, error?: string) {
  trackEvent("payment_failed", { method, booking_id: bookingId, error_message: error || "" });
}

export function trackPaymentCancelled(method: string, bookingId: string) {
  trackEvent("payment_cancelled", { method, booking_id: bookingId });
}

export function trackBookingConfirmedView(bookingId: string, status: string) {
  trackEvent("booking_confirmed_view", { booking_id: bookingId, status });
}

export function trackLockExpired(bookingId: string) {
  trackEvent("lock_expired", { booking_id: bookingId });
}

export function trackLockSuccess(bookingId: string) {
  trackEvent("lock_success", { booking_id: bookingId });
}

export function trackLockFailed(error: string) {
  trackEvent("lock_failed", { error_message: error });
}

// ─── Discount & Coupons ──────────────────────────────────────────

export function trackCouponApplied(code: string, discountAmount: number) {
  trackEvent("coupon_applied", { coupon_code: code, discount_amount: discountAmount });
}

export function trackCouponFailed(code: string, reason?: string) {
  trackEvent("coupon_failed", { coupon_code: code, reason: reason || "" });
}

export function trackNewUserDiscountApplied(discountAmount: number) {
  trackEvent("new_user_discount_applied", { discount_amount: discountAmount });
}

// ─── UPI QR Flow ─────────────────────────────────────────────────
// (trackUpiQrShown / trackUpiPaymentConfirmed now live with the rest of
//  the UPI journey below, and carry the surface + app + timing that make
//  them answerable questions rather than bare counters.)

export function trackUpiWhatsappClick(bookingId?: string) {
  trackEvent("upi_whatsapp_screenshot_click", { booking_id: bookingId || "" });
}

/**
 * Fired when a mobile-browser user taps the "Pay with UPI App" deep-link
 * button — i.e. opts to launch their installed UPI app on the same
 * device instead of scanning the QR with another phone.
 */
export function trackUpiAppLaunched(amount: number) {
  trackEvent("upi_app_launched", { amount });
}

/**
 * The UPI payment journey, end to end.
 *
 * `upi_app_selected` is the one that was missing and the one most worth
 * having: it names WHICH app the customer chose. Everything downstream —
 * whether they came back, whether it confirmed, how long it took — is
 * only interpretable once you can group by app, because the failure modes
 * are per-app (an app that never returns, an app whose intent link is
 * rejected, an app people pick and then abandon).
 *
 * `surface` distinguishes booking / cafe / pass / tournament / camp, so a
 * funnel can be read per product rather than as one blended number.
 * Keep these names identical to apps/mobile/src/lib/analytics.ts.
 */
export type UpiSurface =
  | "booking"
  | "cafe"
  | "pass"
  | "tournament"
  | "camp";

/** gtag rejects null; "unknown" keeps the field present and groupable
 *  rather than silently dropping the row out of an app breakdown. */
function upiParams(p: Record<string, unknown>): GtagParams {
  return Object.fromEntries(
    Object.entries(p).map(([k, v]) => [k, v === null ? "unknown" : v]),
  ) as GtagParams;
}

export function trackUpiCheckoutOpened(p: {
  surface: UpiSurface;
  amount: number;
  mode: "qr" | "intent";
}) {
  trackEvent("upi_checkout_opened", upiParams(p), "PAYMENT");
}

export function trackUpiQrShown(p: {
  surface: UpiSurface;
  amount: number;
  mode: "qr" | "intent";
}) {
  trackEvent("upi_qr_shown", upiParams(p), "PAYMENT");
}

/** Which app the customer tapped, before the handoff. */
export function trackUpiAppSelected(p: {
  surface: UpiSurface;
  amount: number;
  app: string;
  appName: string;
  mode: "qr" | "intent";
}) {
  trackEvent("upi_app_selected", upiParams(p), "PAYMENT");
}

/** They came back to us. `secondsAway` is how long the UPI app had them —
 *  a very short return usually means the app bounced them straight out. */
export function trackUpiReturned(p: {
  surface: UpiSurface;
  app: string | null;
  secondsAway: number;
}) {
  trackEvent("upi_returned", upiParams(p), "PAYMENT");
}

/** Terminal outcomes. `secondsWaited` is measured from the QR/intent
 *  being shown, so the three are directly comparable. */
export function trackUpiPaymentConfirmed(p: {
  surface: UpiSurface;
  amount: number;
  app: string | null;
  mode: "qr" | "intent";
  secondsWaited: number;
}) {
  trackEvent("upi_payment_confirmed", upiParams(p), "PAYMENT");
}

export function trackUpiPaymentExpired(p: {
  surface: UpiSurface;
  amount: number;
  app: string | null;
  mode: "qr" | "intent";
  secondsWaited: number;
}) {
  trackEvent("upi_payment_expired", upiParams(p), "PAYMENT");
}

/** Closed the sheet without a result. `phase` says how far they got, so
 *  "gave up staring at the QR" is separable from "left for an app and
 *  never came back" — different problems with different fixes. */
export function trackUpiPaymentAbandoned(p: {
  surface: UpiSurface;
  amount: number;
  app: string | null;
  mode: "qr" | "intent";
  phase: string;
  secondsWaited: number;
}) {
  trackEvent("upi_payment_abandoned", upiParams(p), "PAYMENT");
}

/** "I've already paid" — the customer asserting the money left. */
export function trackUpiClaimedPaid(p: {
  surface: UpiSurface;
  amount: number;
  app: string | null;
}) {
  trackEvent("upi_claimed_paid", upiParams(p), "PAYMENT");
}

// ─── Login Funnel ────────────────────────────────────────────────

export function trackLoginModalOpened() {
  trackEvent("login_modal_opened");
}

export function trackLoginPhoneSubmitted() {
  trackEvent("login_phone_submitted");
}

export function trackLoginOtpSubmitted() {
  trackEvent("login_otp_submitted");
}

export function trackLoginSuccess() {
  trackEvent("login_success");
}

export function trackLoginFailed(error: string) {
  trackEvent("login_failed", { error_message: error });
}

// ─── Navigation ──────────────────────────────────────────────────

export function trackBottomNavClick(tab: string) {
  trackEvent("bottom_nav_click", { tab });
}

export function trackHomepageSportClick(sport: string) {
  trackEvent("homepage_sport_click", { sport });
}

export function trackHomepageCafeClick() {
  trackEvent("homepage_cafe_click");
}

export function trackHomepageCallClick() {
  trackEvent("homepage_call_click");
}

export function trackHomepageDirectionsClick() {
  trackEvent("homepage_directions_click");
}

export function trackHomepageLoginClick() {
  trackEvent("homepage_login_click");
}

// ─── Cafe Funnel ─────────────────────────────────────────────────

export function trackCafeItemAdded(itemName: string, price: number) {
  trackEvent("cafe_item_added", { item_name: itemName, price });
}

export function trackCafeItemRemoved(itemName: string) {
  trackEvent("cafe_item_removed", { item_name: itemName });
}

export function trackCafeCheckoutStarted(itemCount: number, totalAmount: number) {
  trackEvent("cafe_checkout_started", { item_count: itemCount, total_amount: totalAmount });
}

export function trackCafePaymentMethodSelected(method: string) {
  trackEvent("cafe_payment_method_selected", { method });
}

export function trackCafeOrderPlaced(orderId: string, amount: number, method: string) {
  trackEvent("cafe_order_placed", {
    order_id: orderId,
    amount,
    payment_method: method,
  });
  trackEvent("purchase", {
    currency: "INR",
    value: amount,
    transaction_id: orderId,
  });
}

export function trackCafeOrderConfirmationView(orderId: string) {
  trackEvent("cafe_order_confirmation_view", { order_id: orderId });
}

// ─── Dashboard ───────────────────────────────────────────────────

export function trackDashboardView() {
  trackEvent("dashboard_view");
}

export function trackBookingCardClick(bookingId: string) {
  trackEvent("booking_card_click", { booking_id: bookingId });
}

export function trackInvoiceDownload(bookingId: string) {
  trackEvent("invoice_download", { booking_id: bookingId });
}

export function trackSignOutClick() {
  trackEvent("sign_out_click");
}

// ─── Chat Widget ─────────────────────────────────────────────────

export function trackChatWidgetOpened() {
  trackEvent("chat_widget_opened");
}

export function trackChatMessageSent() {
  trackEvent("chat_message_sent");
}

// ─── Errors ──────────────────────────────────────────────────────

export function trackError(errorType: string, message: string) {
  trackEvent("app_error", { error_type: errorType, error_message: message });
}

// ─── Waitlist ────────────────────────────────────────────────────
// First entry-point of the waitlist funnel. Fired the moment the
// user taps an unavailable (but future) slot — even if they don't
// complete the join. Lets us measure drop-off between "tapped" and
// "joined" so we can tighten the dialog copy if needed.

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
  trackEvent("waitlist_book_now_click", { waitlist_id: waitlistId }, "WAITLIST");
}

// ─── Navigation ──────────────────────────────────────────────────
// Fires once per route change (client-side). Wired in
// app/layout.tsx via a small client-only PageViewTracker. Don't
// call this from feature code — let the tracker handle it.

export function trackPageView(path: string, referrerPath?: string) {
  trackEvent(
    "page_view",
    { path, referrer_path: referrerPath },
    "NAVIGATION",
  );
}

// ─── Admin ───────────────────────────────────────────────────────

export function trackAdminLogin(adminUsername: string) {
  trackEvent("admin_login", { admin_username: adminUsername }, "ADMIN");
}

export function trackAdminAction(
  action: string,
  bookingId?: string,
  meta?: Record<string, string | number | boolean | undefined>,
) {
  trackEvent(
    "admin_action",
    { action, booking_id: bookingId, ...meta },
    "ADMIN",
  );
}

// ─── Rewards ─────────────────────────────────────────────────────

/** Fired on /rewards page mount — drives the Rewards funnel step 2. */
export function trackRewardsView(pointsAvailable: number) {
  trackEvent("rewards_view", { points_available: pointsAvailable }, "REWARDS");
}

/** Fired when a user opens the redeem flow in checkout. Wired up
 *  alongside the redeem-slider integration (deferred). */
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

/** Header chip / dashboard tile tap — discovery signal. */
export function trackRewardsChipClick(source: "header" | "dashboard_tile") {
  trackEvent("rewards_chip_click", { source }, "REWARDS");
}

// ─── Passes funnel ───────────────────────────────────────────────

export function trackPassPurchaseStarted(
  planId: string,
  price: number,
  method: "upi" | "razorpay",
) {
  trackEvent("pass_purchase_started", { plan_id: planId, price, method });
}

export function trackPassPurchaseCompleted(
  planId: string,
  price: number,
  method: "upi" | "razorpay",
) {
  trackEvent("pass_purchase_completed", { plan_id: planId, price, method });
}

/** A booking paid (fully or partly) with pass hours. remainder 0 = full
 *  coverage; >0 = hours + a gateway top-up. */
export function trackPassRedeemed(coveredMinutes: number, remainderAmount: number) {
  trackEvent("pass_redeemed", {
    covered_minutes: coveredMinutes,
    remainder_amount: remainderAmount,
    full_coverage: remainderAmount === 0,
  });
}

export function trackPassMemberAdded() {
  trackEvent("pass_member_added");
}

// ── Tournaments funnel ──────────────────────────────────────────────
// Mirrors apps/mobile/src/lib/analytics.ts so hub → detail → register →
// live reads as one funnel across web and app in GA4. The app half was
// wired with the module; the web half was missed, which is why the
// tournament screens reported nothing.
export function trackTournamentHubView() {
  trackEvent("tournament_hub_view");
}

export function trackTournamentView(slug: string) {
  trackEvent("tournament_view", { slug });
}

export function trackTournamentRegisterStarted(slug: string, fee: number) {
  trackEvent("tournament_register_started", { slug, fee });
}

export function trackTournamentRegisterCompleted(
  slug: string,
  state: string,
  method: string,
) {
  trackEvent("tournament_register_completed", { slug, state, method });
}

export function trackTournamentLiveView(matchId: string) {
  trackEvent("tournament_live_view", { match_id: matchId });
}

// ── Camps funnel ────────────────────────────────────────────────────
// hub → detail → register, mirrored in apps/mobile/src/lib/analytics.ts
// so the funnel reads as one across web and app.
export function trackCampsHubView() {
  trackEvent("camps_hub_view");
}

export function trackCampView(slug: string) {
  trackEvent("camp_view", { slug });
}

export function trackCampRegisterStarted(slug: string, fee: number) {
  trackEvent("camp_register_started", { slug, fee });
}

export function trackCampRegisterCompleted(
  slug: string,
  state: string,
  method: string,
) {
  trackEvent("camp_register_completed", { slug, state, method });
}
