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
  Book: NavigatorScreenParams<BookStackParamList>;
  Cafe: undefined;
  Account: NavigatorScreenParams<AccountStackParamList>;
};

/**
 * Root stack. Auth (Phone, Otp) is presented as a modal flow triggered when
 * a user chooses to sign in — the landing experience is public.
 */
export type RootStackParamList = {
  Main: NavigatorScreenParams<MainTabsParamList>;
  Phone: undefined;
  Otp: { phone: string };
};
