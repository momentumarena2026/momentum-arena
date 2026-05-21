"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import {
  applyPointsRedemptionToHold,
  clearPointsRedemptionFromHold,
} from "@/actions/booking";
import { getRedemptionPreview } from "@/actions/rewards";
import {
  trackRewardsRedeemStarted,
  trackRewardsRedeemCompleted,
} from "@/lib/analytics";

interface Props {
  holdId: string;
  /** Bill the redemption cap is computed against, IN RUPEES (post-coupon). */
  billRupees: number;
  /** Called whenever the redemption pick changes. The parent uses
   *  `paiseSaved` to recompute the payable amount, then passes the new
   *  amount through to the Razorpay/PhonePe/UPI/Cash initiators. */
  onChange: (state: { points: number; paiseSaved: number }) => void;
  /** Re-run the preview whenever this value changes — typically when a
   *  coupon is applied/removed (which changes the cap base). */
  billNonce?: number;
}

/**
 * Customer-side redemption checkbox for the booking checkout.
 *
 * Filename is historical — the component used to render a draggable
 * slider that let users pick any value between 0 and maxPoints. The
 * data model still supports a partial redemption (SlotHold persists
 * `pointsToRedeem` as a number), but UX research showed users either
 * "use all my points" or "don't use them" — almost never picked a
 * sub-max amount. Replaced with a simple all-or-nothing toggle.
 *
 * Behaviour:
 *   - Hidden when rewards are disabled, when the user has fewer points
 *     than minPointsToRedeem, or when the bill caps maxPoints below
 *     minPointsToRedeem.
 *   - Checked → applies the FULL preview.maxPoints (the most the user
 *     could redeem given balance + cap%).
 *   - Unchecked → clears the redemption.
 *
 * The actual REDEEMED_BOOKING ledger row is NOT written here — that
 * happens atomically inside createBookingFromHold when the booking
 * lands. This component just persists the pick on the SlotHold so
 * the booking-creation transaction picks it up.
 */
export function RedeemSlider({ holdId, billRupees, onChange, billNonce }: Props) {
  const [preview, setPreview] = useState<{
    enabled: boolean;
    maxPoints: number;
    pointsAvailable: number;
    pointValuePaise: number;
    minPoints: number;
    blockedReason?: string;
  } | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const [pendingApply, setPendingApply] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fires `rewards_redeem_started` once per checkout session — the
  // funnel cares about "user opted into the redeem flow", not "user
  // toggled the checkbox on and off".
  const startedFiredRef = useRef(false);

  // Default is "redemption ON" — we auto-apply the full eligible
  // amount as soon as the preview loads, so the customer doesn't
  // have to hunt for the checkbox to use the points they've already
  // earned. If they explicitly opt OUT (uncheck), this ref flips
  // and subsequent preview loads (when they apply or clear a
  // coupon) respect that choice. Re-checking flips it back.
  const userOptedOutRef = useRef(false);

  // Load preview whenever the bill changes (coupon apply/clear).
  useEffect(() => {
    let cancelled = false;
    setError(null);
    // Reset the parent's saved amount until the new preview comes
    // back — the previous bill's maxPoints would be stale. If
    // auto-apply kicks in below it'll repopulate within the same tick.
    setRedeeming(false);
    onChange({ points: 0, paiseSaved: 0 });
    getRedemptionPreview({ billPaise: billRupees * 100 })
      .then((p) => {
        if (cancelled) return;
        if (!p) {
          setPreview(null);
          return;
        }
        const next = {
          enabled: p.enabled,
          maxPoints: p.maxPoints,
          pointsAvailable: p.pointsAvailable,
          pointValuePaise: p.pointValuePaise,
          minPoints: p.minPoints,
          blockedReason: p.blockedReason,
        };
        setPreview(next);

        // Auto-apply when eligible and the user hasn't explicitly
        // opted out. Same gate the render uses below to decide
        // whether to even show the checkbox.
        const eligible =
          next.enabled &&
          next.pointsAvailable >= next.minPoints &&
          next.maxPoints >= next.minPoints &&
          !next.blockedReason;
        if (eligible && !userOptedOutRef.current) {
          setRedeeming(true);
          const paiseSaved = next.maxPoints * next.pointValuePaise;
          onChange({ points: next.maxPoints, paiseSaved });
          if (!startedFiredRef.current) {
            startedFiredRef.current = true;
            trackRewardsRedeemStarted(billRupees * 100, next.maxPoints);
          }
          void commitToHold(true, next.maxPoints);
        }
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billRupees, billNonce]);

  async function commitToHold(nextOn: boolean, maxPoints: number) {
    setPendingApply(true);
    try {
      if (!nextOn) {
        await clearPointsRedemptionFromHold(holdId);
        setError(null);
        return;
      }
      const result = await applyPointsRedemptionToHold(holdId, maxPoints);
      if (!result.success) {
        setError(result.error ?? "Couldn't apply points");
        // Roll the UI back to off — the hold doesn't have the
        // redemption, so the parent's payable amount should match.
        setRedeeming(false);
        onChange({ points: 0, paiseSaved: 0 });
        return;
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setRedeeming(false);
      onChange({ points: 0, paiseSaved: 0 });
    } finally {
      setPendingApply(false);
    }
  }

  function handleToggle() {
    if (!preview) return;
    if (pendingApply) return;
    const nextOn = !redeeming;
    setRedeeming(nextOn);
    // Remember the user's explicit choice so coupon apply/clear
    // (which re-runs the preview effect) doesn't fight them — if
    // they turned it OFF, keep it off even after the bill changes;
    // if they turn it back ON, resume the default auto-apply
    // behavior on future preview loads.
    userOptedOutRef.current = !nextOn;
    const nextPoints = nextOn ? preview.maxPoints : 0;
    const paiseSaved = nextPoints * preview.pointValuePaise;
    onChange({ points: nextPoints, paiseSaved });
    if (nextOn && !startedFiredRef.current) {
      startedFiredRef.current = true;
      trackRewardsRedeemStarted(billRupees * 100, preview.maxPoints);
    }
    void commitToHold(nextOn, preview.maxPoints);
  }

  // Listen for the parent telling us "payment landed" via a custom
  // event so we can fire the completed analytic. Cheaper than threading
  // a callback through every payment path.
  useEffect(() => {
    function onCompleted(e: Event) {
      const detail = (e as CustomEvent<{ points: number; paiseSaved: number }>)
        .detail;
      if (detail.points > 0) {
        trackRewardsRedeemCompleted(detail.points, detail.paiseSaved);
      }
    }
    window.addEventListener("rewards:redeem-completed", onCompleted);
    return () =>
      window.removeEventListener("rewards:redeem-completed", onCompleted);
  }, []);

  if (!preview) return null;
  if (!preview.enabled) return null;
  if (preview.pointsAvailable < preview.minPoints) return null;

  const paiseSaved = preview.maxPoints * preview.pointValuePaise;
  const rupeesSaved = Math.floor(paiseSaved / 100);

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-semibold text-white">
            Use Momentum Points
          </span>
        </div>
        <span className="text-xs text-emerald-300/80">
          Balance: {preview.pointsAvailable.toLocaleString("en-IN")} pts
        </span>
      </div>

      {preview.blockedReason ? (
        <p className="text-xs text-amber-300/80">{preview.blockedReason}</p>
      ) : preview.maxPoints < preview.minPoints ? (
        <p className="text-xs text-zinc-400">
          Need at least {preview.minPoints} points (this bill caps you below).
        </p>
      ) : (
        <>
          {/* All-or-nothing checkbox row. Tap the whole row to toggle
              so the hit target is generous on mobile. */}
          <button
            type="button"
            role="checkbox"
            aria-checked={redeeming}
            disabled={pendingApply}
            onClick={handleToggle}
            className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
              redeeming
                ? "border-emerald-400 bg-emerald-500/10"
                : "border-zinc-700 bg-zinc-900 hover:border-zinc-600"
            } ${pendingApply ? "opacity-60 cursor-wait" : "cursor-pointer"}`}
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                redeeming
                  ? "border-emerald-400 bg-emerald-500"
                  : "border-zinc-600 bg-zinc-950"
              }`}
              aria-hidden
            >
              {redeeming ? (
                <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
              ) : null}
            </span>
            <span className="flex-1 text-sm text-zinc-100">
              Redeem{" "}
              <strong className="text-white">
                {preview.maxPoints.toLocaleString("en-IN")}
              </strong>{" "}
              pts
              <span className="ml-2 text-emerald-300">
                — save ₹{rupeesSaved.toLocaleString("en-IN")}
              </span>
            </span>
          </button>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </>
      )}
    </div>
  );
}
