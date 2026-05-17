import type { NavigatorScreenParams } from "@react-navigation/native";
import type { Sport } from "../lib/types";

export type AccountStackParamList = {
  AccountHome: undefined;
  EditName: undefined;
  BookingsList: undefined;
  RecurringBookings: undefined;
  BookingDetail: { bookingId: string };
  Waitlist: undefined;
  Rewards: undefined;
};

export type BookStackParamList = {
  BookSport: undefined;
  BookCourt: { sport: Sport };
  // Either target a specific court config, or hand the server a "medium"
  // mode and let it pick whichever half-court is free at game time.
  BookSlots:
    | { courtConfigId: string; courtLabel: string; sport: Sport; mode?: undefined }
    | { mode: "medium"; courtLabel: string; sport: Sport; courtConfigId?: undefined };
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
  Cafe: undefined;
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
  // Customer's order history — every shop order they've placed.
  // Reachable from the Account screen tile and from the order
  // detail screen via the back-stack.
  //
  // `from` is set by callers that jump in from outside the Shop
  // tab (today only "Account"). The ShopOrders headerLeft uses
  // this hint to route back to the originating tab when the
  // in-stack back-history is empty — without it the bottom-tab
  // navigator's default backBehavior ("firstRoute") sends the
  // user to Home, which is jarring.
  ShopOrders: { from?: "Account" } | undefined;
  ShopOrderDetail: { orderId: string };
};

export type RootStackParamList = {
  Main: NavigatorScreenParams<MainTabsParamList>;
  Phone: undefined;
  Otp: { phone: string };
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

// Calendar tab is a tiny stack so it can host both the day grid and
// the slot-blocks editor. Web has these as two separate pages
// (/admin/calendar, /admin/slots); we collapse them into one tab
// because they share the date context.
export type AdminCalendarStackParamList = {
  AdminCalendar: undefined;
  AdminSlotBlocks: undefined;
};

// Cafe tab: orders kanban (default) + menu (availability toggle).
// Mirrors web /admin/cafe + /admin/cafe-orders rolled into one tab.
export type AdminCafeStackParamList = {
  AdminCafeOrders: undefined;
  AdminCafeMenu: undefined;
};

// Expenses tab: list (default) + per-row edit + add + analytics.
// Add and edit share one form screen — the param `expenseId` is the
// editing flag (undefined ⇒ creating).
export type AdminExpensesStackParamList = {
  AdminExpensesList: undefined;
  AdminExpenseForm: { expenseId?: string };
  AdminExpenseAnalytics: undefined;
};

export type AdminTabsParamList = {
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
};

export type AdminRewardsStackParamList = {
  AdminRewardsHome: undefined;
  AdminRewardsDistribute: undefined;
};
