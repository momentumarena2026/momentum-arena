"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { RedeemSlider } from "@/components/rewards/redeem-slider";
import { formatPrice } from "@/lib/pricing";

interface Props {
  holdId: string;
  /** Pre-redemption total in rupees (post coupon + auto-promo + recurring
   *  discount). The redeem row subtracts off this; Total renders as
   *  preDiscountTotal - paiseSaved/100 + equipmentTotalRupees. */
  preDiscountTotal: number;
  /** Bumped by the parent whenever an upstream discount changes
   *  (manual coupon apply/clear, new-user discount). Passed straight
   *  through to RedeemSlider so its cap recomputes. */
  billNonce?: number;
  /** Rental gear total in rupees — locked from the slot-selection
   *  page, displayed read-only above this row in the Booking Summary
   *  tile. Added back into the rendered Total so the line items add
   *  up. The points-redeem cap is computed against the pre-gear
   *  bill (preDiscountTotal) because RedeemSlider's cap math already
   *  uses the pre-discount slot bill upstream. */
  equipmentTotalRupees?: number;
  /** Earn-rate in basis points for THIS booking's sport (already
   *  gated server-side: 0 when rewards are disabled, the sport is
   *  excluded, or this is admin-created). The component recomputes
   *  the projected earn locally whenever Total changes so the
   *  customer sees the number react to coupon / points / advance
   *  toggles — same recomputation server runs at award time after
   *  payment confirmation. */
  earnRateBookingBps?: number;
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
export function SummaryFooter({
  holdId,
  preDiscountTotal,
  billNonce,
  equipmentTotalRupees = 0,
  earnRateBookingBps = 0,
}: Props) {
  const [redemption, setRedemption] = useState<{
    points: number;
    paiseSaved: number;
  }>({ points: 0, paiseSaved: 0 });

  // Post-coupon base. Starts at the SSR `preDiscountTotal` and is updated
  // when the sibling CheckoutClient applies/clears a coupon (it lives across
  // a server boundary, so it tells us via the `checkout:discount-changed`
  // window event — the reverse of redemption-changed we send it). Without
  // this the summary Total ignored a coupon applied in the discount drawer.
  const [effectiveBase, setEffectiveBase] = useState(preDiscountTotal);
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onDiscountChanged(e: Event) {
      const detail = (e as CustomEvent<{ effectiveAmount?: number }>).detail;
      if (detail && typeof detail.effectiveAmount === "number") {
        setEffectiveBase(detail.effectiveAmount);
      }
    }
    window.addEventListener("checkout:discount-changed", onDiscountChanged);
    return () =>
      window.removeEventListener("checkout:discount-changed", onDiscountChanged);
  }, []);

  const rupeesSaved = Math.floor(redemption.paiseSaved / 100);
  const total = effectiveBase - rupeesSaved + equipmentTotalRupees;

  // Project the points the customer will earn on this booking. Same
  // bps math the server runs at award time (see lib/rewards/earn.ts
  // computeEarnPoints): floor(billRupees × bps / 100). Updates
  // reactively as Total changes. Hidden when the engine is disabled
  // for this sport (earnRateBookingBps === 0) or the math floors out.
  const projectedEarn = Math.max(
    0,
    Math.floor((Math.max(0, total) * earnRateBookingBps) / 10000),
  );

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
        billRupees={effectiveBase}
        billNonce={billNonce}
        onChange={setRedemption}
      />

      <div className="mt-2 flex justify-between border-t border-zinc-800 pt-2">
        <span className="font-semibold text-white">Total</span>
        <span className="text-lg font-bold text-emerald-400">
          {formatPrice(total)}
        </span>
      </div>

      {/* Earn preview — auto-hides when the engine is off, the sport
          is excluded server-side, or the bps × bill floors to zero
          (e.g. tiny bookings). Reactive to coupon/points/advance so
          the customer sees the number tick down if they redeem. */}
      {projectedEarn > 0 && (
        <div className="mt-1 flex items-center justify-end gap-1.5 text-xs text-emerald-400/90">
          <Sparkles className="h-3 w-3" />
          <span>
            You&apos;ll earn{" "}
            <span className="font-semibold">
              {projectedEarn.toLocaleString("en-IN")}
            </span>{" "}
            Momentum {projectedEarn === 1 ? "Point" : "Points"} on this
            booking
          </span>
        </div>
      )}
    </>
  );
}
