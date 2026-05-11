"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
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
 * Customer-side redemption slider for the booking checkout. Computes
 * the maximum redeemable amount via getRedemptionPreview() and lets
 * the user pick anywhere from 0 → maxPoints in step-of-1 increments.
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
  const [points, setPoints] = useState(0);
  const [pendingApply, setPendingApply] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Used to debounce server-side hold updates so dragging the slider
  // doesn't fire 50 server actions per drag.
  const applyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fires `rewards_redeem_started` once per checkout session — the
  // funnel cares about "user opened the redeem flow", not "user
  // dragged the slider 20 times".
  const startedFiredRef = useRef(false);

  // Load preview whenever the bill changes (coupon apply/clear).
  useEffect(() => {
    let cancelled = false;
    setPoints(0);
    setError(null);
    onChange({ points: 0, paiseSaved: 0 });
    getRedemptionPreview({ billPaise: billRupees * 100 })
      .then((p) => {
        if (cancelled) return;
        if (!p) {
          setPreview(null);
          return;
        }
        setPreview({
          enabled: p.enabled,
          maxPoints: p.maxPoints,
          pointsAvailable: p.pointsAvailable,
          pointValuePaise: p.pointValuePaise,
          minPoints: p.minPoints,
          blockedReason: p.blockedReason,
        });
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billRupees, billNonce]);

  function commitToHold(nextPoints: number) {
    if (applyTimerRef.current) clearTimeout(applyTimerRef.current);
    applyTimerRef.current = setTimeout(async () => {
      setPendingApply(true);
      try {
        if (nextPoints <= 0) {
          await clearPointsRedemptionFromHold(holdId);
        } else {
          const result = await applyPointsRedemptionToHold(holdId, nextPoints);
          if (!result.success) {
            setError(result.error ?? "Couldn't apply points");
            // Roll the UI back to 0 — the hold doesn't have the
            // redemption, the parent's payable amount should match.
            setPoints(0);
            onChange({ points: 0, paiseSaved: 0 });
            return;
          }
          setError(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      } finally {
        setPendingApply(false);
      }
    }, 350);
  }

  function handleSlider(value: number) {
    if (!preview) return;
    // Snap below the min to 0 — slider can land on 1–49 mid-drag, and
    // committing those would just bounce off the min check.
    const v = value < preview.minPoints ? 0 : value;
    if (!startedFiredRef.current && v > 0) {
      startedFiredRef.current = true;
      trackRewardsRedeemStarted(billRupees * 100, preview.maxPoints);
    }
    setPoints(v);
    const paiseSaved = v * preview.pointValuePaise;
    onChange({ points: v, paiseSaved });
    commitToHold(v);
  }

  function handleClear() {
    if (!preview) return;
    setPoints(0);
    onChange({ points: 0, paiseSaved: 0 });
    commitToHold(0);
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

  const paiseSaved = points * preview.pointValuePaise;
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
          <input
            type="range"
            min={0}
            max={preview.maxPoints}
            step={1}
            value={points}
            onChange={(e) => handleSlider(parseInt(e.target.value, 10))}
            className="w-full accent-emerald-500"
            aria-label="Redeem points"
          />
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>0 pts</span>
            <span>
              max {preview.maxPoints.toLocaleString("en-IN")} pts
            </span>
          </div>

          {points > 0 ? (
            <div className="flex items-center justify-between rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-2">
              <span className="text-sm text-emerald-200">
                Using <strong className="text-white">{points.toLocaleString("en-IN")}</strong> pts —
                saving <strong className="text-white">₹{rupeesSaved.toLocaleString("en-IN")}</strong>
              </span>
              <button
                type="button"
                onClick={handleClear}
                disabled={pendingApply}
                className="inline-flex items-center gap-1 rounded text-xs text-zinc-400 hover:text-zinc-200"
                aria-label="Clear points redemption"
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </button>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">
              Drag the slider to apply up to {preview.maxPoints.toLocaleString("en-IN")} pts off this bill.
            </p>
          )}

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}
        </>
      )}
    </div>
  );
}
