"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatHourRangeCompact,
  formatHoursAsRanges,
  summarizeAvailability,
  summarizeBlockers,
} from "@/lib/court-config";
import { formatPrice } from "@/lib/pricing";
import type { SlotAvailability } from "@/lib/availability";
import {
  type ActiveSportPromo,
  computeAutoApplyDiscount,
} from "@/lib/auto-apply-promo";
import { Bell, Clock, Check, ArrowRightLeft, Hourglass } from "lucide-react";

/** "4:07" / "0:09" — mm:ss, floored, never negative. */
function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

interface SlotGridProps {
  slots: SlotAvailability[];
  selectedHours: number[];
  onSelectionChange: (hours: number[]) => void;
  /**
   * Called when a user taps an unavailable (but still future) slot.
   * If provided, future-booked tiles become interactive with a RED
   * highlight + Bell + "Notify me" label so users can join the
   * waitlist. Past slots (`hour <= pastHourCutoff`) ignore this
   * callback — they're rendered as plain disabled grey since you
   * can't waitlist for a slot that's already started.
   */
  onUnavailableClick?: (hour: number) => void;
  /**
   * Called when a user taps a SOFT-blocked tile — one that's
   * unavailable on this exact court but where the same hour is
   * still bookable on a sibling court (e.g. Full Field is booked
   * but Right Half is free). Tile renders AMBER + reason tag
   * ("Right half booked · See alternatives") instead of the red
   * notify-me treatment, and tap fires this callback so the
   * parent can pop an alternatives sheet listing the sibling
   * configs that are still free at that hour.
   *
   * Falls through to `onUnavailableClick` when the slot has no
   * alternatives (true hard-block, e.g. Full Field genuinely full).
   */
  onShowAlternatives?: (slot: SlotAvailability) => void;
  /**
   * The current IST hour, ONLY when the selected date is today.
   * `undefined` means the selected date is in the future (no slots
   * are past). Slots with `hour <= pastHourCutoff` are treated as
   * past — see `joinWaitlist` server-side check for the matching
   * cutoff semantics.
   */
  pastHourCutoff?: number;
  /**
   * Active auto-apply promo for this sport. When `promo.percentOff` is
   * non-null we render each available tile with strike-through original
   * + amber discounted price, and the selection-summary total mirrors
   * the same treatment. Per-slot math uses computeAutoApplyDiscount,
   * which mirrors the validator's Math.floor formula exactly so the
   * displayed total = the amount the user pays at checkout.
   */
  promo?: ActiveSportPromo | null;
  /**
   * Fired once when the soonest checkout hold on the grid lapses.
   * The parent should refetch availability: the tile has just counted
   * down to zero, and leaving it there — or worse, letting it sit at
   * "frees in 0:00" — is exactly the dead end this whole treatment
   * exists to remove. Without it the customer would have to guess when
   * to reload, which is what we told them they wouldn't have to do.
   */
  onLockExpired?: () => void;
}

export function SlotGrid({
  slots,
  selectedHours,
  onSelectionChange,
  onUnavailableClick,
  onShowAlternatives,
  pastHourCutoff,
  promo,
  onLockExpired,
}: SlotGridProps) {
  // ── Live countdown on slots someone else is paying for ───────────
  // One clock for the whole grid rather than an interval per tile;
  // each tile derives its own remaining time from it.
  const [now, setNow] = useState(() => Date.now());

  // The earliest hold to lapse. Null when nothing on this grid is
  // mid-checkout, which is the common case — and when it's null we
  // never start an interval at all, so a fully-booked or fully-free
  // grid costs nothing.
  const soonestExpiry = useMemo(() => {
    const times = slots
      .filter((s) => s.status === "locked" && s.lockKind === "checkout" && s.lockedUntil)
      .map((s) => Date.parse(s.lockedUntil!))
      .filter((t) => Number.isFinite(t));
    return times.length > 0 ? Math.min(...times) : null;
  }, [slots]);

  useEffect(() => {
    if (soonestExpiry == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [soonestExpiry]);

  // Ask for fresh availability the moment the first hold lapses.
  // Keyed on the expiry timestamp so a grid that keeps re-rendering
  // fires exactly one refetch per hold, not one per tick.
  const refetchedFor = useRef<number | null>(null);
  useEffect(() => {
    if (soonestExpiry == null || !onLockExpired) return;
    if (now < soonestExpiry || refetchedFor.current === soonestExpiry) return;
    refetchedFor.current = soonestExpiry;
    onLockExpired();
  }, [now, soonestExpiry, onLockExpired]);

  const toggleSlot = useCallback(
    (hour: number) => {
      if (selectedHours.includes(hour)) {
        onSelectionChange(selectedHours.filter((h) => h !== hour));
      } else {
        onSelectionChange([...selectedHours, hour].sort((a, b) => a - b));
      }
    },
    [selectedHours, onSelectionChange]
  );

  // Per-slot decoration: uncapped PERCENTAGE promos slice exactly per
  // slot; FLAT promos show each tile at price − value (the price you'd
  // pay booking that one slot). Capped percentage stays undecorated —
  // the cap makes any per-slot number wrong. The SELECTION TOTAL below
  // always uses checkout's real math (flat applies once per booking).
  const showDiscount =
    promo != null && (promo.percentOff != null || promo.type === "FLAT");
  const discountedPrice = (rupees: number) =>
    promo ? rupees - computeAutoApplyDiscount(rupees, promo) : rupees;

  const totalOriginal = slots
    .filter((s) => selectedHours.includes(s.hour))
    .reduce((sum, s) => sum + s.price, 0);
  // PERCENTAGE promos slice per slot (sum of per-slot floors = the
  // whole-order discount); FLAT promos apply ONCE to the selection
  // total — per-tile decoration stays off for them, but the selection
  // summary still strikes the total, which is exactly what checkout
  // will charge.
  const totalDiscounted =
    promo?.percentOff != null
      ? slots
          .filter((s) => selectedHours.includes(s.hour))
          .reduce((sum, s) => sum + discountedPrice(s.price), 0)
      : promo && totalOriginal > 0
        ? Math.max(0, totalOriginal - computeAutoApplyDiscount(totalOriginal, promo))
        : totalOriginal;

  return (
    <div className="space-y-4">
      {/* Slot Grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {slots.map((slot) => {
          const isSelected = selectedHours.includes(slot.hour);
          const isAvailable = slot.status === "available";

          // A slot is "past" when the selected date is today and the
          // slot's start hour has already arrived. Matches the server's
          // joinWaitlist cutoff (expiresAt <= now). Past slots get the
          // plain disabled treatment — no Bell, no waitlist option.
          const isPast =
            pastHourCutoff !== undefined && slot.hour <= pastHourCutoff;

          // Soft block — unavailable on THIS court, but the same hour
          // is still bookable on a sibling court (e.g. Full Field is
          // taken but Right Half is free). Renders AMBER and the tap
          // opens the alternatives sheet via the parent. Takes priority
          // over the red notify-me treatment because pivoting to an
          // available alternative is a better outcome than waitlisting.
          const altCount = slot.blockedReason?.alternativesAtThisHour.length ?? 0;
          const softBlockInteractive =
            !isAvailable &&
            !isPast &&
            altCount > 0 &&
            Boolean(onShowAlternatives);

          // Booked AND in the future AND a waitlist handler is wired —
          // ONLY when the slot has no available alternatives. Once we
          // surface an amber-pivot path, the red notify-me would
          // crowd the tile.
          const bookedFutureInteractive =
            !isAvailable &&
            !isPast &&
            !softBlockInteractive &&
            Boolean(onUnavailableClick);

          // Someone is on the payment screen for this slot right now.
          // Distinct from booked, and worth saying so: the hold dies by
          // itself, usually within a couple of minutes, and a customer
          // told "Booked" walks away from a slot that is about to come
          // back. Once the countdown passes zero we stop claiming a
          // time and fall back to the plain treatment until the
          // refetch above lands.
          const isCheckoutLock =
            slot.status === "locked" &&
            slot.lockKind === "checkout" &&
            Boolean(slot.lockedUntil);
          const lockMsLeft = isCheckoutLock
            ? Date.parse(slot.lockedUntil!) - now
            : NaN;
          const payingNow = Number.isFinite(lockMsLeft) && lockMsLeft > 0 && !isPast;
          // The countdown has run out but the refetch hasn't landed
          // yet. Falling through to the "Booked · Notify me" branch
          // here would put the exact wrong message back on screen for
          // the couple of seconds that matter most — the moment the
          // customer is watching to see whether they got the slot.
          const lockSettling =
            isCheckoutLock && !payingNow && !isPast && Number.isFinite(lockMsLeft);
          // Paid by static QR / UPI, waiting on an admin to match the
          // UTR. No countdown — that wait has no knowable end, and
          // inventing one would be worse than saying nothing.
          const verifying =
            slot.status === "locked" && slot.lockKind === "verification" && !isPast;

          // The pivot still outranks both: booking a free half NOW
          // beats waiting out someone else's checkout.
          const payingTile = (payingNow || lockSettling) && !softBlockInteractive;
          const verifyingTile = verifying && !softBlockInteractive && !payingTile;

          // Amber tile (soft block) tag — positive framing, derived
          // from what's STILL bookable. Customer reads "Half
          // Available" whether a half-court or the bowling machine
          // triggered the block. Only meaningful when alternatives
          // exist, i.e. when softBlockInteractive is true.
          const availabilityTag = slot.blockedReason
            ? summarizeAvailability(slot.blockedReason.alternativesAtThisHour)
            : null;
          // Red tile (hard block / notify-me) tag — keeps the
          // specific blocker info ("Full court booked") so the
          // user who joins the waitlist understands what they're
          // queuing on.
          const blockedReasonTag = slot.blockedReason
            ? summarizeBlockers(slot.blockedReason.blockedBy)
            : null;

          return (
            <button
              key={slot.hour}
              onClick={() => {
                if (isAvailable) {
                  toggleSlot(slot.hour);
                } else if (softBlockInteractive && onShowAlternatives) {
                  onShowAlternatives(slot);
                } else if (bookedFutureInteractive && onUnavailableClick) {
                  onUnavailableClick(slot.hour);
                }
              }}
              disabled={
                !isAvailable && !softBlockInteractive && !bookedFutureInteractive
              }
              className={`relative rounded-xl border p-3 text-left transition-all duration-200 ${
                isSelected
                  ? "border-emerald-400 bg-emerald-500/20 ring-1 ring-emerald-400/50"
                  : isAvailable
                    ? "bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30"
                    : softBlockInteractive
                      ? "bg-amber-500/10 border-amber-500/40 hover:bg-amber-500/15 hover:border-amber-500/60 cursor-pointer"
                      : payingTile
                        ? // Sky, not amber: amber already means "there's
                          // another court you can pivot to" on this same
                          // grid. Two ambers meaning different things is
                          // how a colour code stops being read at all.
                          "bg-sky-500/10 border-sky-500/40 hover:bg-sky-500/15 hover:border-sky-500/60 cursor-pointer"
                        : bookedFutureInteractive
                          ? "bg-red-500/10 border-red-500/40 hover:bg-red-500/15 hover:border-red-500/60 cursor-pointer"
                          : "bg-zinc-800/50 border-zinc-700 cursor-not-allowed opacity-50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Clock className="h-3 w-3 shrink-0 text-zinc-500" />
                  {/* `whitespace-nowrap` keeps the time on one line so the
                      tile height stays uniform across all sports (bowling's
                      "9:30am - 10am" was wrapping at text-sm). `text-xs`
                      matches what the bowling format needs to fit the
                      mobile 2-col grid; hourly cricket/football/pickleball
                      shrink in lockstep so the grid looks consistent. */}
                  <span className="whitespace-nowrap text-xs font-medium text-white">
                    {formatHourRangeCompact(slot.hour)}
                  </span>
                </div>
                {isSelected && <Check className="h-4 w-4 text-emerald-400" />}
                {softBlockInteractive && (
                  <ArrowRightLeft className="h-3.5 w-3.5 text-amber-400" />
                )}
                {payingTile ? (
                  <Hourglass className="h-3.5 w-3.5 text-sky-400" />
                ) : bookedFutureInteractive ? (
                  <Bell className="h-3.5 w-3.5 text-red-400" />
                ) : null}
              </div>
              <div
                className={`mt-1 text-xs ${
                  isAvailable
                    ? "text-zinc-400"
                    : softBlockInteractive
                      ? "text-amber-300/90"
                      : payingTile
                        ? "text-sky-300/90"
                        : bookedFutureInteractive
                          ? "text-red-300/90"
                          : "text-zinc-500"
                }`}
              >
                {isAvailable ? (
                  showDiscount ? (
                    <span className="inline-flex items-baseline gap-1.5">
                      <span className="text-zinc-500 line-through">
                        {formatPrice(slot.price)}
                      </span>
                      <span className="font-semibold text-yellow-300">
                        {formatPrice(discountedPrice(slot.price))}
                      </span>
                    </span>
                  ) : (
                    formatPrice(slot.price)
                  )
                ) : softBlockInteractive ? (
                  // Soft block — positive framing on what's still
                  // bookable ("Half Available") rather than what's
                  // blocked. The arrow icon at the top right signals
                  // the pivot affordance.
                  <span className="block">
                    {availabilityTag ?? "Available"}
                    <span className="block text-[10px] text-amber-400/80">
                      Tap to see options
                    </span>
                  </span>
                ) : payingTile ? (
                  // Someone else's checkout, with the minute it lapses.
                  // The countdown is the point: it turns "gone" into a
                  // short, specific wait, and the grid refetches itself
                  // when it runs out so nobody has to sit and reload.
                  <span className="block">
                    {payingNow ? "Being paid for" : "Checking…"}
                    <span className="block text-[10px] font-semibold text-sky-400">
                      {payingNow ? `Frees in ${mmss(lockMsLeft)}` : "Just a moment"}
                    </span>
                  </span>
                ) : verifyingTile ? (
                  // No countdown here on purpose — an admin has to match
                  // the UTR by hand and that can take hours, so the only
                  // honest thing to offer is the bell.
                  <span className="block">
                    Payment being verified
                    {bookedFutureInteractive && (
                      <span className="block text-[10px] text-red-400/80">
                        Notify me
                      </span>
                    )}
                  </span>
                ) : bookedFutureInteractive ? (
                  // Hard block — render the reason where we have one
                  // so the user knows what's specifically full, then
                  // the existing Notify-me affordance.
                  blockedReasonTag
                    ? `${blockedReasonTag} · Notify me`
                    : "Booked · Notify me"
                ) : isPast ? (
                  "Past"
                ) : (
                  "Unavailable"
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Selection Summary */}
      {selectedHours.length > 0 && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-400">
                {selectedHours.length} slot{selectedHours.length > 1 ? "s" : ""} selected
              </p>
              <p className="text-xs text-zinc-500">
                {formatHoursAsRanges(selectedHours)}
              </p>
            </div>
            <div className="text-right">
              {totalDiscounted < totalOriginal ? (
                <p className="text-lg font-bold">
                  <span className="mr-2 text-sm text-zinc-500 line-through">
                    {formatPrice(totalOriginal)}
                  </span>
                  <span className="text-yellow-300">
                    {formatPrice(totalDiscounted)}
                  </span>
                </p>
              ) : (
                <p className="text-lg font-bold text-emerald-400">
                  {formatPrice(totalOriginal)}
                </p>
              )}
              <p className="text-xs text-zinc-500">Total</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
