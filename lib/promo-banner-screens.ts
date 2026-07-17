/**
 * Promo-banner screen registry — pure (no db imports) so client
 * components (admin manager form) can share the exact list the server
 * validates against. Values mirror the BannerPlacement enum.
 */
export const PROMO_SCREENS = [
  { value: "HOME_TOP", label: "Home — above upcoming bookings" },
  { value: "HOME_PROMO", label: "Home — promo slot (mid-page)" },
  { value: "BOOK_SPORT", label: "Book — choose sport" },
  { value: "SLOT_SELECTION", label: "Slot selection" },
  { value: "CAFE", label: "Cafe" },
  { value: "SHOP", label: "Shop" },
  { value: "PASSES", label: "Passes storefront" },
] as const;

export type PromoScreen = (typeof PROMO_SCREENS)[number]["value"];
