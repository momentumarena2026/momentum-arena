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
  AdminBookingDetail: { bookingId: string };
};

export type AdminTabsParamList = {
  AdminBookings: NavigatorScreenParams<AdminBookingsStackParamList>;
  AdminCafe: undefined;
  AdminExpenses: undefined;
};
