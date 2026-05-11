/**
 * Funnel definitions — data only. Lives outside actions/ because a
 * "use server" file can only export async functions; pages need the
 * step-name lists (and the FunnelKey union) at module scope, not as
 * server actions.
 *
 * Step names MUST match emitted event names from lib/analytics.ts
 * (web) and apps/mobile/src/lib/analytics.ts (mobile). Order =
 * display order = drop-off computation order.
 */

export const FUNNELS = {
  booking: {
    label: "Booking",
    steps: [
      "sport_selected",
      "court_config_selected",
      "date_changed",
      "slot_toggled",
      "proceed_to_checkout_click",
      "checkout_started",
      "payment_initiated",
      "payment_completed",
      "booking_confirmed_view",
    ] as const,
  },
  cafe: {
    label: "Cafe",
    steps: [
      "cafe_browse",
      "cafe_item_added",
      "cafe_checkout_started",
      "cafe_payment_completed",
      "cafe_order_confirmation_view",
    ] as const,
  },
  waitlist: {
    label: "Waitlist",
    steps: [
      "slot_unavailable_tap",
      "waitlist_joined",
      "waitlist_notification_tapped",
      "waitlist_book_now_click",
    ] as const,
  },
  auth: {
    label: "Auth",
    steps: [
      "login_modal_opened",
      "login_phone_submitted",
      "login_otp_submitted",
      "login_success",
    ] as const,
  },
  // Rewards funnel — measures discovery → engagement → redemption.
  // `rewards_view` is emitted from the /rewards page (web) and the
  // RewardsScreen (mobile). The redeem-side events will start
  // populating once the checkout slider integration lands; until
  // then they show 0 in the funnel view, which is the correct signal
  // (we genuinely don't have a redemption path live yet).
  rewards: {
    label: "Rewards",
    steps: [
      "login_success",
      "rewards_view",
      "rewards_redeem_started",
      "rewards_redeem_completed",
    ] as const,
  },
} as const;

export type FunnelKey = keyof typeof FUNNELS;
