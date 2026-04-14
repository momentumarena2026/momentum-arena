/**
 * Google Analytics 4 event tracking utilities
 * Central module for all GA4 custom events across Momentum Arena
 */

type GtagParams = Record<string, string | number | boolean | undefined>;

const GA_MEASUREMENT_ID = "G-JV1973H52L";
const PRODUCTION_HOST = "www.momentumarena.com";

/** Core event dispatcher — only fires on production domain */
export function trackEvent(eventName: string, params?: GtagParams) {
  if (typeof window === "undefined") return;
  if (window.location.hostname !== PRODUCTION_HOST) return;
  if (!window.gtag) return;
  window.gtag("event", eventName, params);
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

export function trackUpiQrShown(amount: number) {
  trackEvent("upi_qr_shown", { amount });
}

export function trackUpiPaymentConfirmed(amount: number) {
  trackEvent("upi_payment_confirmed", { amount });
}

export function trackUpiWhatsappClick(bookingId?: string) {
  trackEvent("upi_whatsapp_screenshot_click", { booking_id: bookingId || "" });
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
