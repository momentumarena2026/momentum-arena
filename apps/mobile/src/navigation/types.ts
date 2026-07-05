import type { NavigatorScreenParams } from "@react-navigation/native";
import type { Sport } from "../lib/types";

export type AccountStackParamList = {
  AccountHome: undefined;
  EditName: undefined;
  BookingsList: undefined;
  RecurringBookings: undefined;
  BookingDetail: { bookingId: string };
  Waitlist: undefined;
  Coupons: undefined;
  Rewards: undefined;
  // Graphical "how Momentum Points work" page — every value driven by
  // the live RewardConfig so admin edits flow through with no manual
  // copy update. Mirrors web's /rewards/how-it-works.
  RewardsHowItWorks: undefined;
  // Shop order history lives here (not in ShopStack) because the only
  // entry point is the Account screen's "Shop orders" tile. Registering
  // it here means:
  //   - the Shop tab can never get "stuck" on ShopOrders (Shop tab tap
  //     in the bottom nav always lands on ShopHome)
  //   - back from ShopOrders pops to AccountHome naturally — no
  //     special headerLeft override needed
  // ShopOrderDetail is registered in BOTH AccountStack (reached from
  // the orders list) and ShopStack (reached from ShopCheckout after a
  // successful purchase). Same screen component, two registrations.
  ShopOrders: undefined;
  ShopOrderDetail: { orderId: string };
  // Cafe order history mirrors Shop's pattern — entry from the
  // Account screen tile, registered here so the Cafe tab can never
  // get "stuck" on the orders list after a cross-tab jump.
  CafeOrders: undefined;
  CafeOrderDetail: { orderId: string };
};

export type BookStackParamList = {
  BookSport: undefined;
  BookCourt: { sport: Sport };
  // Either target a specific court config, or hand the server a "medium"
  // mode and let it pick whichever half-court is free at game time.
  //
  // `prefilledDate` ("YYYY-MM-DD") is set when the user pivots between
  // courts via the AlternativesSheet — preserves the date they were
  // looking at on the prior court so they don't have to re-pick.
  // Optional; omitted from the BookCourt entry-flow navigations.
  BookSlots:
    | { courtConfigId: string; courtLabel: string; sport: Sport; mode?: undefined; prefilledDate?: string }
    | { mode: "medium"; courtLabel: string; sport: Sport; courtConfigId?: undefined; prefilledDate?: string };
  // Bowling-machine 30-min slot picker — separate screen from BookSlots
  // because the picker UI (consecutive 30-min tiles) and the lock
  // payload (`slots[]` instead of `hours[]`) differ enough that
  // forking is simpler than branching.
  BookBowlingSlots: { courtConfigId: string; courtLabel: string; sport: Sport };
  Checkout: { holdId: string };
  BookingConfirmed: { bookingId: string };
};

export type MainTabsParamList = {
  Home: undefined;
  // Tab key kept as "Sports" to mirror the web bottom-nav label
  // (`/book` → "Sports"). The underlying stack is still the booking
  // funnel — naming is purely a UX decision so the user understands
  // they're picking a sport, not a date.
  Sports: NavigatorScreenParams<BookStackParamList>;
  Cafe: NavigatorScreenParams<CafeStackParamList>;
  // Shop sits at the 4th position — pickup-at-venue product catalog
  // for items the customer can buy alongside or independently of a
  // booking. Account stays on the right edge of the nav.
  Shop: NavigatorScreenParams<ShopStackParamList>;
  Account: NavigatorScreenParams<AccountStackParamList>;
};

/**
 * Root stack. Auth (Phone, Otp) is presented as a modal flow triggered when
 * a user chooses to sign in — the landing experience is public.
 *
 * AdminLogin is a hidden modal reached by 5-tapping the version footer
 * on the Account screen. Same modal-stack pattern as Phone/Otp so it
 * sits visually above the tab navigator.
 */
export type ShopStackParamList = {
  ShopHome: undefined;
  ShopCart: undefined;
  ShopCheckout: undefined;
  // ShopOrderDetail stays here because ShopCheckoutScreen pushes to
  // it after a successful purchase. The orders LIST (ShopOrders) is
  // not part of this stack — it lives in AccountStack so the Shop
  // tab can never get polluted by a cross-tab jump from Account.
  ShopOrderDetail: { orderId: string };
};

/**
 * Cafe stack — mirror of ShopStack. Menu + Cart + Checkout +
 * post-checkout order detail. The orders LIST and the orders
 * DETAIL when reached from that list live on AccountStack so the
 * Cafe tab can never get stuck on "My orders" after a cross-tab
 * jump from Account.
 *
 * CafeOrderDetail is registered in BOTH stacks (here for the
 * post-checkout success navigation, and on AccountStack for the
 * orders-list drill-down). Same screen, two registrations.
 */
export type CafeStackParamList = {
  CafeMenu: undefined;
  CafeCart: undefined;
  CafeCheckout: undefined;
  CafeOrderDetail: { orderId: string };
};

export type RootStackParamList = {
  Main: NavigatorScreenParams<MainTabsParamList>;
  Phone: undefined;
  Otp: { phone: string; referralCode?: string };
  AdminLogin: undefined;
  AdminShell: NavigatorScreenParams<AdminTabsParamList>;
  // Chat was a 5th tab pre-shop; moved here as a presented stack so
  // it can still be opened from the Account screen tile without
  // taking up a bottom-nav slot.
  Chat: undefined;
};

/** Admin nav stacks live inside AdminShell — reachable only from the
 *  signed-in admin context. The customer-app entry never sees these. */
export type AdminBookingsStackParamList = {
  AdminBookingsList: undefined;
  // Composite-filtered queue (status PENDING + payment PENDING +
  // method UPI_QR/CASH) — the actionable "needs admin verification"
  // list that mirrors the web /admin/bookings/unconfirmed page.
  AdminUnconfirmedBookingsList: undefined;
  AdminBookingDetail: { bookingId: string };
  AdminEditSlots: { bookingId: string };
  AdminEditBooking: { bookingId: string };
  AdminEditPayment: { bookingId: string };
  // Optional prefill from the calendar's "+ Add" tile so the
  // staffer lands on the create form with date / hour / sport
  // already populated. All three optional — the entry point from
  // "+ New Booking" on the list passes nothing and gets blank
  // defaults (today + first available sport).
  AdminCreateBooking:
    | {
        prefillDate?: string;
        prefillHour?: number;
        prefillSport?: "CRICKET" | "FOOTBALL" | "PICKLEBALL";
      }
    | undefined;
};

// Calendar tab = the day grid ONLY. Slot Blocks is a separate feature
// (web: /admin/slots, a Courts & Pricing sidebar page) and now lives in
// the More stack — keeping it out of the Calendar tab prevents the tab
// from getting "stuck" on Slot Blocks after a cross-nav from the More hub.
export type AdminCalendarStackParamList = {
  AdminCalendar: undefined;
};

// Cafe tab: orders kanban (default) + menu (availability toggle).
// Mirrors web /admin/cafe + /admin/cafe-orders rolled into one tab.
export type AdminCafeStackParamList = {
  AdminCafeOrders: undefined;
  AdminCafeMenu: undefined;
  AdminCafeCreateOrder: undefined;
};

// Expenses tab: list (default) + per-row edit + add + analytics.
// Add and edit share one form screen — the param `expenseId` is the
// editing flag (undefined ⇒ creating).
//
// The same three screens serve TWO modules parameterized by the
// optional `module` route param: absent ⇒ GENERAL (the original
// expense log, flat list), "RUNNING" ⇒ Running Expenses (month-wise
// recurring costs, month-collapsible list). The More hub navigates
// here with explicit params so the two flavors never bleed into each
// other's screens or react-query caches.
export type AdminExpensesStackParamList = {
  AdminExpensesList: { module?: "RUNNING" } | undefined;
  AdminExpenseForm: { expenseId?: string; module?: "RUNNING" };
  AdminExpenseAnalytics: { module?: "RUNNING" } | undefined;
};

// "More" hub stack: the grouped, permission-gated menu (root) plus every
// secondary admin screen that isn't on a primary tab. Phase 1+ screens are
// registered here so the hub can push to them.
export type AdminMoreStackParamList = {
  AdminMoreHome: undefined;
  AdminSports: undefined;
  AdminEquipment: undefined;
  AdminBowling: undefined;
  AdminPricing: undefined;
  AdminCoupons: undefined;
  AdminProducts: undefined;
  AdminProductOrders: undefined;
  AdminPos: undefined;
  AdminPush: undefined;
  // Automated (event-triggered) push templates — toggle + copy editor.
  AdminPushTemplates: undefined;
  AdminOta: undefined;
  AdminReleaseFlow: undefined;
  AdminUsers: undefined;
  AdminUserGroups: undefined;
  AdminFaqs: undefined;
  AdminGenerator: undefined;
  // Slot Blocks (web /admin/slots) — a Courts & Pricing feature, reached
  // from the More hub, NOT the Calendar tab.
  AdminSlotBlocks: undefined;
  // Analytics dashboards (Sports analytics is a bottom TAB, not here)
  AdminCafeAnalytics: undefined;
  AdminPushAnalytics: undefined;
  AdminDemand: undefined;
  AdminCohorts: undefined;
  AdminFunnels: undefined;
  AdminEvents: undefined;
  // Settings (payments/profile)
  AdminPaymentSettings: undefined;
  AdminRazorpay: undefined;
  AdminPhonePe: undefined;
  AdminAdminUsers: undefined;
  AdminProfile: undefined;
  // Bookings extras + legacy discounts
  AdminRecovery: undefined;
  AdminRecurringConfig: undefined;
  AdminUtrVerify: undefined;
  AdminDiscounts: undefined;
  AdminReports: undefined;
};

export type AdminTabsParamList = {
  // Sports analytics — the first bottom tab (replaced the Dashboard/Home tab).
  AdminSportsAnalytics: undefined;
  // Dashboard / Home — KPI cards + quick actions. No longer a bottom tab
  // (hidden); still registered so quick-action deep-links + the More-hub
  // "Dashboard" row resolve.
  AdminHome: undefined;
  AdminBookings: NavigatorScreenParams<AdminBookingsStackParamList>;
  // Check-in: today's confirmed bookings list with manual-entry +
  // QR-token paste fallbacks. Mirrors the web /admin/checkin page,
  // minus the live camera scanner (we surface a manual entry form
  // and the today-list instead so a staffer can always proceed even
  // when camera permission is denied).
  AdminCheckin: undefined;
  // Calendar tab — stack containing the court×hour grid and the
  // slot-blocks editor.
  AdminCalendar: NavigatorScreenParams<AdminCalendarStackParamList>;
  AdminCafe: NavigatorScreenParams<AdminCafeStackParamList>;
  AdminExpenses: NavigatorScreenParams<AdminExpensesStackParamList>;
  // Momentum Rewards monitoring + bulk grant. Mirrors the web
  // /admin/rewards Overview/Alerts/Distribute surface; the full
  // 5-tab admin remains on web only.
  AdminRewards: NavigatorScreenParams<AdminRewardsStackParamList>;
  // "More" hub tab — hosts the grouped menu + secondary admin screens.
  AdminMore: NavigatorScreenParams<AdminMoreStackParamList>;
};

export type AdminRewardsStackParamList = {
  AdminRewardsHome: undefined;
  AdminRewardsAnalytics: undefined;
  AdminRewardsDistribute: undefined;
  AdminRewardsTransactions: undefined;
  AdminRewardsConfig: undefined;
};
