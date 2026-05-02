import type { NavigatorScreenParams } from "@react-navigation/native";
import type { Sport } from "../lib/types";

export type AccountStackParamList = {
  AccountHome: undefined;
  EditName: undefined;
  BookingsList: undefined;
  RecurringBookings: undefined;
  BookingDetail: { bookingId: string };
};

export type BookStackParamList = {
  BookSport: undefined;
  BookCourt: { sport: Sport };
  // Either target a specific court config, or hand the server a "medium"
  // mode and let it pick whichever half-court is free at game time.
  BookSlots:
    | { courtConfigId: string; courtLabel: string; sport: Sport; mode?: undefined }
    | { mode: "medium"; courtLabel: string; sport: Sport; courtConfigId?: undefined };
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
  Account: NavigatorScreenParams<AccountStackParamList>;
  // Mirrors web's ChatNavButton — 5th tab opens the Arena Assistant
  // chat (same chat-engine, full-screen on mobile instead of a
  // floating widget).
  Chat: undefined;
};

/**
 * Root stack. Auth (Phone, Otp) is presented as a modal flow triggered when
 * a user chooses to sign in — the landing experience is public.
 *
 * AdminLogin is a hidden modal reached by 5-tapping the version footer
 * on the Account screen. Same modal-stack pattern as Phone/Otp so it
 * sits visually above the tab navigator.
 */
export type RootStackParamList = {
  Main: NavigatorScreenParams<MainTabsParamList>;
  Phone: undefined;
  Otp: { phone: string };
  AdminLogin: undefined;
  AdminShell: NavigatorScreenParams<AdminTabsParamList>;
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
  AdminCreateBooking: undefined;
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
};
