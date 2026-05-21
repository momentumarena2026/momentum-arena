"use client";

import { useEffect, useState } from "react";
import { RedeemSlider } from "@/components/rewards/redeem-slider";
import { formatPrice } from "@/lib/pricing";

interface Props {
  holdId: string;
  /** Pre-redemption total in rupees (post coupon + auto-promo + recurring
   *  discount). The redeem row subtracts off this; Total renders as
   *  preDiscountTotal - paiseSaved/100. */
  preDiscountTotal: number;
  /** Bumped by the parent whenever an upstream discount changes
   *  (manual coupon apply/clear, new-user discount). Passed straight
   *  through to RedeemSlider so its cap recomputes. */
  billNonce?: number;
}

/**
 * Footer that sits INSIDE the Booking Summary tile on the checkout
 * page. Two rows:
 *
 *   1. <RedeemSlider variant="row" /> — single inline checkbox.
 *      Auto-hides when the customer has no redeemable points.
 *   2. Total — reactive to the redemption pick.
 *
 * Architecture: page.tsx (server) hands `preDiscountTotal` to this
 * client island so the Total stays in sync without lifting the
 * whole summary tile into client land. When the redemption pick
 * changes we dispatch a window CustomEvent `checkout:redemption-
 * changed` so the sibling CheckoutClient (which owns the payment
 * gateway buttons) can mirror the same number into its
 * `effectiveAmount` state. Same lightweight pattern the
 * `rewards:redeem-completed` analytics event uses.
 */
export function SummaryFooter({ holdId, preDiscountTotal, billNonce }: Props) {
  const [redemption, setRedemption] = useState<{
    points: number;
    paiseSaved: number;
  }>({ points: 0, paiseSaved: 0 });

  const rupeesSaved = Math.floor(redemption.paiseSaved / 100);
  const total = preDiscountTotal - rupeesSaved;

  // Whenever the redemption picks change, broadcast so the payment
  // gateway buttons in CheckoutClient pick up the same number.
  // Sibling-to-sibling communication across a server boundary —
  // can't share state via a parent or React context.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("checkout:redemption-changed", {
        detail: {
          points: redemption.points,
          paiseSaved: redemption.paiseSaved,
        },
      }),
    );
  }, [redemption.points, redemption.paiseSaved]);

  return (
    <>
      <RedeemSlider
        variant="row"
        holdId={holdId}
        billRupees={preDiscountTotal}
        billNonce={billNonce}
        onChange={setRedemption}
      />

      <div className="mt-2 flex justify-between border-t border-zinc-800 pt-2">
        <span className="font-semibold text-white">Total</span>
        <span className="text-lg font-bold text-emerald-400">
          {formatPrice(total)}
        </span>
      </div>
    </>
  );
}
