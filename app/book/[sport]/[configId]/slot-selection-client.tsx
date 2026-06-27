"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { DatePicker } from "@/components/booking/date-picker";
import { SlotGrid } from "@/components/booking/slot-grid";
import { WaitlistDialog } from "@/components/booking/waitlist-dialog";
import { AlternativesSheet } from "@/components/booking/alternatives-sheet";
import { CheckoutAuth } from "@/components/checkout-auth";
import { formatPrice } from "@/lib/pricing";
import { formatHoursAsRanges } from "@/lib/court-config";
import type { SlotAvailability } from "@/lib/availability";
import { Loader2, RefreshCw, Calendar } from "lucide-react";
import { getPublicRecurringConfig } from "@/actions/admin-recurring";
import type { RecurringTier, DailyTier } from "@/actions/admin-recurring";
import {
  type ActiveSportPromo,
  computeAutoApplyDiscount,
} from "@/lib/auto-apply-promo";
import { getCurrentHourIST, getTodayIST } from "@/lib/ist-date";
import { GearPicker } from "@/components/booking/gear-picker";
import type { EquipmentOption } from "@/lib/equipment";
import {
  trackSlotToggled,
  trackDateChanged,
  trackRecurringToggled,
  trackRecurringModeSelected,
  trackRecurringDurationSelected,
  trackProceedToCheckout,
  trackLockSuccess,
  trackLockFailed,
} from "@/lib/analytics";

interface SlotSelectionClientProps {
  // `configId` is the specific LEFT/RIGHT/FULL court config for the regular
  // flow. In mediumMode it is a stable synthetic key (e.g., "medium-cricket")
  // used only for session-storage scoping — the server picks the actual
  // courtConfigId at lock time.
  configId: string;
  sport: string;
  sportName: string;
  courtLabel: string;
  courtSize: string;
  userId?: string;
  userPhone?: string;
  // When true, availability is fetched from the merged LEFT+RIGHT view and
  // the lock endpoint is called with mode=medium (server auto-assigns half).
  // Recurring-booking UI is hidden in this mode.
  mediumMode?: boolean;
  /**
   * Active auto-apply promo for this sport, fetched server-side from the
   * Coupon table. When `promo.percentOff` is non-null, slot tiles are
   * decorated with strike-through originals + amber discounted prices
   * and a launch-offer banner renders above the grid. Both UI elements
   * are gated on this prop existing — when admin disables the coupon in
   * /admin/coupons the next request returns null and everything hides.
   */
  promo?: ActiveSportPromo | null;
  /** Rental equipment options for this sport/category. Empty array
   *  hides the gear picker entirely. Fetched RSC-side in page.tsx so
   *  the picker can render without a client-side round-trip. */
  equipmentOptions?: EquipmentOption[];
}

export function SlotSelectionClient({
  configId,
  sport,
  courtLabel,
  userId,
  mediumMode = false,
  promo = null,
  equipmentOptions = [],
}: SlotSelectionClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  // Pre-fill date from `?date=YYYY-MM-DD` when the user landed here
  // via the AlternativesSheet on another court — so the pivot
  // preserves the date they had picked. Falls back to today
  // otherwise. Strict format check keeps malformed query strings
  // from breaking the picker.
  const initialDate = (() => {
    const q = searchParams.get("date");
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
    return getTodayIST();
  })();
  const [selectedDate, setSelectedDate] = useState(initialDate);
  // Tracks which soft-blocked slot's "alternatives" sheet is open.
  // `null` = closed.
  const [alternativesSlot, setAlternativesSlot] =
    useState<SlotAvailability | null>(null);
  const [slots, setSlots] = useState<SlotAvailability[]>([]);
  const [selectedHours, setSelectedHours] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  // Waitlist dialog state. `null` = closed; an hour value = open for
  // that specific slot. Only enabled in single-court mode (mediumMode
  // doesn't have a stable courtConfigId until lock time).
  const [waitlistHour, setWaitlistHour] = useState<number | null>(null);
  // Rental gear picks captured pre-lock. Sent into /api/booking/lock
  // so the hold lands in checkout with equipment already snapshotted —
  // replaces the old standalone "Rent gear" card on the checkout page.
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState<Set<string>>(
    new Set(),
  );
  const pendingAuthRef = useRef(false);
  const storageKey = `slot_selection_${configId}`;

  // Recurring booking state
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringMode, setRecurringMode] = useState<"weekly" | "daily">("weekly");
  const [weeksCount, setWeeksCount] = useState(4);
  const [daysCount, setDaysCount] = useState(3);
  const [recurringConfig, setRecurringConfig] = useState<{
    enabled: boolean;
    tiers: RecurringTier[];
    allowedDays: number[];
    maxWeeks: number;
    minWeeks: number;
    dailyTiers: DailyTier[];
    maxDays: number;
    minDays: number;
  } | null>(null);
  const [recurringConfigLoading, setRecurringConfigLoading] = useState(true);

  // Fetch recurring config on mount
  useEffect(() => {
    getPublicRecurringConfig()
      .then((cfg) => {
        setRecurringConfig(cfg);
        if (cfg) {
          if (cfg.minWeeks > 1) {
            setWeeksCount(cfg.tiers.length > 0 ? cfg.tiers[0].weeks : cfg.minWeeks);
          }
          if (cfg.minDays > 1) {
            setDaysCount(cfg.dailyTiers.length > 0 ? cfg.dailyTiers[0].days : cfg.minDays);
          }
        }
      })
      .catch(() => setRecurringConfig(null))
      .finally(() => setRecurringConfigLoading(false));
  }, []);

  // Clear any stale slot selection on mount (fresh start every visit)
  useEffect(() => {
    sessionStorage.removeItem(storageKey);
  }, [storageKey]);

  // If the page was left open across midnight, the IST "today" advances while
  // selectedDate still points at yesterday. When the tab regains focus or
  // becomes visible again, snap forward to today and drop any stale selection
  // so the user can't proceed to checkout on a past date.
  useEffect(() => {
    const syncToToday = () => {
      const today = getTodayIST();
      setSelectedDate((prev) => {
        if (prev < today) {
          setSelectedHours([]);
          setError(null);
          return today;
        }
        return prev;
      });
    };
    window.addEventListener("focus", syncToToday);
    document.addEventListener("visibilitychange", syncToToday);
    // Also re-check once a minute while the page is open, for users who leave
    // the tab in the foreground overnight.
    const interval = window.setInterval(syncToToday, 60 * 1000);
    return () => {
      window.removeEventListener("focus", syncToToday);
      document.removeEventListener("visibilitychange", syncToToday);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    async function fetchSlots() {
      setLoading(true);
      try {
        const url = mediumMode
          ? `/api/availability?mode=medium&sport=${sport.toUpperCase()}&date=${selectedDate}`
          : `/api/availability?configId=${configId}&date=${selectedDate}`;
        const res = await fetch(url);
        const data = await res.json();
        setSlots(data.slots || []);
      } catch {
        setSlots([]);
      } finally {
        setLoading(false);
      }
    }
    fetchSlots();
    // Only clear selection when date actually changes, not on re-render
  }, [configId, selectedDate, mediumMode, sport]);

  // After auth completes and session is available, auto-proceed to lock
  useEffect(() => {
    if (session?.user && showAuth) {
      // User is now authenticated, hide the auth form
      setShowAuth(false);

      if (pendingAuthRef.current && selectedHours.length > 0) {
        pendingAuthRef.current = false;
        // Small delay to let session cookie propagate
        setTimeout(() => lockAndCheckout(), 500);
      }
    }
  }, [session, showAuth]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedSlotPrices = slots.filter((s) =>
    selectedHours.includes(s.hour)
  );
  const slotTotal = selectedSlotPrices.reduce((sum, s) => sum + s.price, 0);
  // Per-slot decoration only kicks in for an uncapped PERCENTAGE
  // promo (promo.percentOff non-null); same gating SlotGrid uses
  // for its tiles. The sticky footer + handleProceed analytics
  // event read `promoTotal` so the "Continue" pill shows what the
  // checkout will actually charge.
  const showPromo = promo?.percentOff != null;
  const slotPromoTotal = showPromo && promo
    ? selectedSlotPrices.reduce(
        (sum, s) => sum + (s.price - computeAutoApplyDiscount(s.price, promo)),
        0,
      )
    : slotTotal;

  // Rental gear total — per-slot rate × slot count. Customer sees
  // this rolled into the sticky-footer total and the Continue button
  // so the price in front of them matches the eventual checkout.
  // The mobile flow mirrors this math exactly (BookSlotsScreen).
  const rentalTotal = Array.from(selectedEquipmentIds).reduce((sum, id) => {
    const opt = equipmentOptions.find((o) => o.id === id);
    if (!opt) return sum;
    return sum + Math.round(opt.pricePaise / 100) * selectedHours.length;
  }, 0);

  // `total` and `promoTotal` keep their existing semantics for
  // downstream callers (recurring math, analytics) but now include
  // the gear add-on so the visible CTA, slot-pill, and recurring
  // multiplier all reflect what the user is actually about to pay.
  const total = slotTotal + rentalTotal;
  const promoTotal = slotPromoTotal + rentalTotal;

  // User is authenticated if server passed userId OR client session is active
  const isAuthenticated = !!userId || (status === "authenticated" && !!session?.user);

  const handleProceed = async () => {
    if (selectedHours.length === 0) return;

    trackProceedToCheckout(
      selectedHours.length,
      isRecurring ? discountedTotal : total,
      isRecurring,
    );

    // If session is still loading, wait before deciding
    if (status === "loading" && !userId) return;

    // If not logged in, show inline auth
    if (!isAuthenticated) {
      setShowAuth(true);
      return;
    }

    await lockAndCheckout();
  };

  // Derive recurring day from selected date (no more day selector)
  const effectiveRecurringDay = new Date(selectedDate).getDay();

  const lockAndCheckout = async () => {
    setBooking(true);
    setError(null);
    setShowAuth(false);

    try {
      // Resolve the storage coords for the selected slots. The
      // 12am-1am tile lives on the *next* calendar date's grid but
      // its underlying storage is the prior date / startHour 24 —
      // that's surfaced as `lockDate` / `lockHour` on each slot by
      // getDisplayShiftedAvailability. Mixed-date selections (the
      // 12am tile plus any other hour) cross a Booking.date boundary
      // so they can't go in one Booking row; refuse early instead of
      // failing at the API.
      const selectedSlotsResolved = slots.filter((s) =>
        selectedHours.includes(s.hour),
      );
      const lockDateSet = new Set(
        selectedSlotsResolved.map((s) => s.lockDate ?? selectedDate),
      );
      if (lockDateSet.size > 1) {
        setError(
          "You've selected slots that span midnight. Please book the late-night slot separately.",
        );
        setBooking(false);
        return;
      }
      const resolvedLockDate =
        Array.from(lockDateSet)[0] ?? selectedDate;
      const resolvedLockHours = selectedSlotsResolved.map(
        (s) => s.lockHour ?? s.hour,
      );

      const formData = new FormData();
      if (mediumMode) {
        formData.set("mode", "medium");
        formData.set("sport", sport.toUpperCase());
      } else {
        formData.set("courtConfigId", configId);
      }
      formData.set("date", resolvedLockDate);
      formData.set("hours", JSON.stringify(resolvedLockHours));
      // Pre-lock gear picks ride along with the slot lock — the
      // server snapshots them onto the fresh hold so checkout shows
      // a read-only summary instead of a separate picker. Soft-fails
      // server-side on stale items (see lock route comments).
      if (selectedEquipmentIds.size > 0) {
        formData.set(
          "equipmentSelection",
          JSON.stringify(
            Array.from(selectedEquipmentIds).map((id) => ({
              equipmentId: id,
              quantity: 1,
            })),
          ),
        );
      }

      const res = await fetch("/api/booking/lock", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (data.success && data.holdId) {
        trackLockSuccess(data.holdId);
        sessionStorage.removeItem(storageKey);
        const params = new URLSearchParams({ holdId: data.holdId });
        if (!mediumMode && isRecurring && selectedHours.length > 0) {
          params.set("recurring", "1");
          params.set("mode", recurringMode);
          // Use the STORAGE coords (resolvedLockDate / resolvedLockHours), not
          // the display date/hours — else a recurring series seeded off the
          // 12am–1am tile recurs on the wrong day-of-week and mis-dates every
          // occurrence (the tile displays on date D but stores on D-1 / hour 24).
          params.set("dayOfWeek", String(new Date(resolvedLockDate).getDay()));
          params.set("startDate", resolvedLockDate);
          params.set("startHour", String(Math.min(...resolvedLockHours)));
          params.set("endHour", String(Math.max(...resolvedLockHours) + 1));
          params.set("courtConfigId", configId);
          if (recurringMode === "weekly") {
            params.set("weeksCount", String(weeksCount));
            if (currentDiscount > 0) {
              params.set("discountPercent", String(currentDiscount));
            }
          } else {
            params.set("daysCount", String(daysCount));
            if (currentDiscount > 0) {
              params.set("discountPercent", String(currentDiscount));
            }
          }
        }
        router.push(`/book/checkout?${params.toString()}`);
      } else {
        trackLockFailed(data.error || "Failed to lock slots");
        setError(data.error || "Failed to lock slots");
        if (data.conflicts) {
          setSelectedHours((prev) =>
            prev.filter((h) => !data.conflicts.includes(h))
          );
        }
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setBooking(false);
    }
  };

  // Generate preview dates for recurring bookings
  const getRecurringPreviewDates = useCallback(() => {
    if (!selectedDate || !isRecurring) return [];
    const dates: string[] = [];
    const start = new Date(selectedDate);

    if (recurringMode === "weekly") {
      for (let i = 0; i < weeksCount; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i * 7);
        dates.push(d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }));
      }
    } else {
      // Daily mode: consecutive days
      for (let i = 0; i < daysCount; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        dates.push(d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }));
      }
    }
    return dates;
  }, [selectedDate, isRecurring, recurringMode, weeksCount, daysCount]);

  // Calculate recurring discount for current selection
  const getDiscountForWeeks = (weeks: number): number => {
    if (!recurringConfig || !recurringConfig.tiers.length) return 0;
    const applicable = recurringConfig.tiers
      .filter((t) => weeks >= t.weeks)
      .sort((a, b) => b.weeks - a.weeks);
    return applicable.length > 0 ? applicable[0].discountPercent : 0;
  };

  const getDiscountForDays = (days: number): number => {
    if (!recurringConfig || !recurringConfig.dailyTiers.length) return 0;
    const applicable = recurringConfig.dailyTiers
      .filter((t) => days >= t.days)
      .sort((a, b) => b.days - a.days);
    return applicable.length > 0 ? applicable[0].discountPercent : 0;
  };

  const currentDiscount = isRecurring
    ? recurringMode === "weekly"
      ? getDiscountForWeeks(weeksCount)
      : getDiscountForDays(daysCount)
    : 0;

  const recurringCount = recurringMode === "weekly" ? weeksCount : daysCount;
  const recurringUnit = recurringMode === "weekly" ? "week" : "day";
  const recurringUnitPlural = recurringMode === "weekly" ? "weeks" : "days";

  const discountedTotal = isRecurring
    ? Math.round(total * recurringCount * (1 - currentDiscount / 100))
    : total;

  // Generate week options from config
  const weekOptions = (() => {
    if (!recurringConfig) return [2, 3, 4, 6, 8, 10, 12];
    const options: number[] = [];
    for (let w = recurringConfig.minWeeks; w <= recurringConfig.maxWeeks; w++) {
      if (recurringConfig.tiers.some((t) => t.weeks === w) || w % 2 === 0 || w <= 4) {
        options.push(w);
      }
    }
    recurringConfig.tiers.forEach((t) => {
      if (!options.includes(t.weeks) && t.weeks <= recurringConfig.maxWeeks) {
        options.push(t.weeks);
      }
    });
    return [...new Set(options)].sort((a, b) => a - b);
  })();

  // Generate day options from config
  const dayOptions = (() => {
    if (!recurringConfig) return [3, 5, 7, 10, 14, 21, 30];
    const options: number[] = [];
    // Add standard intervals within range
    const standardDays = [2, 3, 5, 7, 10, 14, 21, 30];
    for (const d of standardDays) {
      if (d >= recurringConfig.minDays && d <= recurringConfig.maxDays) {
        options.push(d);
      }
    }
    // Ensure all tier days are included
    recurringConfig.dailyTiers.forEach((t) => {
      if (!options.includes(t.days) && t.days >= recurringConfig.minDays && t.days <= recurringConfig.maxDays) {
        options.push(t.days);
      }
    });
    return [...new Set(options)].sort((a, b) => a - b);
  })();

  const handleAuthenticated = () => {
    // User just logged in -- mark pending so useEffect picks it up when session updates
    pendingAuthRef.current = true;
    // Also try directly in case session is already updated
    setTimeout(() => {
      if (pendingAuthRef.current) {
        pendingAuthRef.current = false;
        setShowAuth(false);
        lockAndCheckout();
      }
    }, 1000);
  };

  return (
    <div className="space-y-6">
      {/* Sticky on scroll so the customer keeps the date strip in
          reach while they're scanning the slot grid below — most
          relevant on mobile, where the grid pushes the date row off
          the top quickly. z-20 sits above the slot tiles but below
          any portaled modal. Opaque bg so slots can't bleed through,
          with a subtle blur as a fallback for older browsers. */}
      <div className="sticky top-0 z-20 -mt-2 bg-black/95 pb-3 pt-2 backdrop-blur supports-[backdrop-filter]:bg-black/70">
        <DatePicker selectedDate={selectedDate} onDateChange={(date) => {
          setSelectedDate(date);
          setSelectedHours([]);
          sessionStorage.removeItem(storageKey);
          trackDateChanged(date);
        }} />
      </div>

      {loading ? (
        // Skeleton grid that matches the live SlotGrid columns
        // (grid-cols-2 sm:grid-cols-3 md:grid-cols-4). Avoids the
        // page jump customers used to see when a spinner gave way to
        // a tall grid on slow connections.
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/60"
            />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-center text-red-400">
          {error}
        </div>
      ) : (
        <>
          {/* Launch-offer banner image. The designer banner already
              carries the "25% OFF · auto-applied at checkout" copy +
              the morning/night price chips, so a parallel text card
              would be redundant.
              Still gated on the live PICKLEBALL25 coupon — when admin
              disables/expires it server-side, this disappears on the
              next request, same as the per-slot strike-through prices. */}
          {promo?.percentOff !== null && promo?.percentOff !== undefined && (
            <div className="overflow-hidden rounded-2xl border border-yellow-500/30 shadow-lg shadow-yellow-500/10">
              <Image
                src="/pickleball-promo-banner.jpg"
                alt={`Pickleball Launch Offer: ${promo.percentOff}% off every slot — auto-applied at checkout`}
                width={1200}
                height={400}
                className="h-auto w-full"
                sizes="(min-width: 768px) 768px, calc(100vw - 32px)"
              />
            </div>
          )}
          <SlotGrid
            slots={slots}
            promo={promo}
            selectedHours={selectedHours}
            onSelectionChange={(hours) => {
              const added = hours.filter((h) => !selectedHours.includes(h));
              const removed = selectedHours.filter((h) => !hours.includes(h));
              added.forEach((h) => {
                const slot = slots.find((s) => s.hour === h);
                trackSlotToggled("add", h, slot?.price || 0);
              });
              removed.forEach((h) => {
                const slot = slots.find((s) => s.hour === h);
                trackSlotToggled("remove", h, slot?.price || 0);
              });
              setSelectedHours(hours);
            }}
            // Waitlist on unavailable tap is single-court only —
            // mediumMode's configId is a synthetic key, not a real
            // CourtConfig.id, so the server can't store it.
            onUnavailableClick={
              mediumMode ? undefined : (h) => setWaitlistHour(h)
            }
            // Soft-block alternatives sheet. Skipped in mediumMode
            // because the user is already viewing the merged half-
            // court view — the only sibling that exists for that
            // surface is Full Field, which would be blocked by
            // definition if both halves are taken.
            onShowAlternatives={
              mediumMode ? undefined : (s) => setAlternativesSlot(s)
            }
            // Past slots aren't joinable — pass the current IST hour
            // ONLY when the user has selected today, so the grid can
            // render past tiles as plain disabled (no Bell, no notify).
            pastHourCutoff={
              selectedDate === getTodayIST() ? getCurrentHourIST() : undefined
            }
          />

        </>
      )}

      {/* Recurring Booking Toggle — not offered for the unified half-court
          flow because recurring selection would need to pin a specific half
          across all occurrences, which conflicts with "venue assigns side
          at game time". */}
      {!mediumMode && selectedHours.length > 0 && !showAuth && recurringConfig?.enabled && !recurringConfigLoading && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <button
              role="switch"
              aria-checked={isRecurring}
              onClick={() => { setIsRecurring(!isRecurring); trackRecurringToggled(!isRecurring); }}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                isRecurring ? "bg-emerald-600" : "bg-zinc-700"
              }`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                  isRecurring ? "translate-x-5" : "translate-x-1"
                }`}
              />
            </button>
            <div>
              <p className="text-sm font-medium text-white">Make this recurring</p>
              <p className="text-xs text-zinc-500">
                {recurringMode === "weekly"
                  ? "Book this slot every week automatically"
                  : "Book this slot for consecutive days"}
              </p>
            </div>
          </label>

          {isRecurring && (
            <div className="space-y-4 pt-2">
              {/* Step 1: Repeat type */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-white">Repeat type</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setRecurringMode("weekly"); trackRecurringModeSelected("weekly"); }}
                    className={`flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                      recurringMode === "weekly"
                        ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400"
                        : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                    }`}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Every Week
                  </button>
                  <button
                    onClick={() => { setRecurringMode("daily"); trackRecurringModeSelected("daily"); }}
                    className={`flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                      recurringMode === "daily"
                        ? "border-blue-500/50 bg-blue-500/15 text-blue-400"
                        : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                    }`}
                  >
                    <Calendar className="h-3.5 w-3.5" />
                    Every Day
                  </button>
                </div>
              </div>

              {/* Step 2: Duration (Weekly) */}
              {recurringMode === "weekly" && (
                <div className="space-y-2">
                  <div>
                    <p className="text-sm font-medium text-white">For how long?</p>
                    <p className="text-xs text-zinc-500">
                      You&apos;ll pay for all {weeksCount} weeks upfront
                      {currentDiscount > 0 && (
                        <span className="text-emerald-400"> — {currentDiscount}% discount applied!</span>
                      )}
                    </p>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {weekOptions.map((w) => {
                      const discount = getDiscountForWeeks(w);
                      const isSelected = weeksCount === w;
                      return (
                        <button
                          key={w}
                          onClick={() => { setWeeksCount(w); trackRecurringDurationSelected("weekly", w, getDiscountForWeeks(w)); }}
                          className={`relative rounded-lg border px-2 py-2.5 text-center transition-colors ${
                            isSelected
                              ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400"
                              : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-600"
                          }`}
                        >
                          <span className="text-sm font-semibold">{w}</span>
                          <span className="text-[10px] text-zinc-500 ml-0.5">{w === 1 ? "week" : "weeks"}</span>
                          {discount > 0 && (
                            <span className={`block text-[10px] font-medium mt-0.5 ${isSelected ? "text-emerald-300" : "text-emerald-500"}`}>
                              Save {discount}%
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Step 2: Duration (Daily) */}
              {recurringMode === "daily" && (
                <div className="space-y-2">
                  <div>
                    <p className="text-sm font-medium text-white">For how many days?</p>
                    <p className="text-xs text-zinc-500">
                      Book the same slot for consecutive days
                      {currentDiscount > 0 && (
                        <span className="text-blue-400"> — {currentDiscount}% discount applied!</span>
                      )}
                    </p>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {dayOptions.map((d) => {
                      const discount = getDiscountForDays(d);
                      const isSelected = daysCount === d;
                      return (
                        <button
                          key={d}
                          onClick={() => { setDaysCount(d); trackRecurringDurationSelected("daily", d, getDiscountForDays(d)); }}
                          className={`relative rounded-lg border px-2 py-2.5 text-center transition-colors ${
                            isSelected
                              ? "border-blue-500/50 bg-blue-500/15 text-blue-400"
                              : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-600"
                          }`}
                        >
                          <span className="text-sm font-semibold">{d}</span>
                          <span className="text-[10px] text-zinc-500 ml-0.5">{d === 1 ? "day" : "days"}</span>
                          {discount > 0 && (
                            <span className={`block text-[10px] font-medium mt-0.5 ${isSelected ? "text-blue-300" : "text-blue-500"}`}>
                              Save {discount}%
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Price Breakdown */}
              <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/50 px-3 py-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>
                    {formatPrice(total)}/{recurringUnit} {"\u00D7"} {recurringCount} {recurringCount === 1 ? recurringUnit : recurringUnitPlural}
                  </span>
                  <span>{formatPrice(total * recurringCount)}</span>
                </div>
                {currentDiscount > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className={recurringMode === "weekly" ? "text-emerald-400" : "text-blue-400"}>
                      Recurring discount ({currentDiscount}%)
                    </span>
                    <span className={recurringMode === "weekly" ? "text-emerald-400" : "text-blue-400"}>
                      -{formatPrice(total * recurringCount - discountedTotal)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-zinc-700/50 pt-1.5">
                  <span className="text-sm font-medium text-white">Total to pay</span>
                  <span className={`text-sm font-bold ${recurringMode === "weekly" ? "text-emerald-400" : "text-blue-400"}`}>
                    {formatPrice(discountedTotal)}
                  </span>
                </div>
              </div>

              {/* Preview: Dates that will be booked */}
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-zinc-400">Your bookings:</p>
                <div className="flex flex-wrap gap-1.5">
                  {getRecurringPreviewDates().map((d, i) => (
                    <span key={i} className="rounded-md bg-zinc-800 border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300">
                      {i === 0 && <span className="text-emerald-400 mr-1">1st</span>}
                      {d}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Inline auth for guests */}
      {showAuth && !isAuthenticated && (
        <CheckoutAuth onAuthenticated={handleAuthenticated} />
      )}

      {/* Bottom spacer for mobile fixed bar */}
      {selectedHours.length > 0 && !showAuth && (
        <div className="h-36 md:h-0" />
      )}

      {selectedHours.length > 0 && !showAuth && (
        <div className="fixed bottom-0 left-0 right-0 z-40 md:sticky md:bottom-4 md:left-auto md:right-auto md:z-auto bg-black/95 backdrop-blur-md border-t border-zinc-800 md:border md:border-zinc-800 md:rounded-xl p-4">
          {/* Gear picker — sits inside the same sticky CTA tile so the
              user sees their cart-like total (slots + gear) directly
              above the Pay button. Per the chosen "smart expand" UX,
              it appears (already expanded) the moment a slot is
              picked. */}
          {equipmentOptions.length > 0 && (
            <div className="mb-3">
              <GearPicker
                options={equipmentOptions}
                selectedIds={selectedEquipmentIds}
                onChange={setSelectedEquipmentIds}
                slotCount={selectedHours.length}
              />
            </div>
          )}
          {/* Slot summary */}
          <div className="flex items-center justify-between mb-2 md:mb-3 text-sm">
            <div className="flex items-center gap-2 text-zinc-400 overflow-hidden">
              <span className="font-medium text-white flex-shrink-0">{selectedHours.length} slot{selectedHours.length > 1 ? "s" : ""}</span>
              <span className="truncate text-xs">
                {formatHoursAsRanges(selectedHours)}
              </span>
            </div>
            <span className={`font-bold flex-shrink-0 ${isRecurring && recurringMode === "daily" ? "text-blue-400" : "text-emerald-400"}`}>
              {isRecurring ? (
                formatPrice(discountedTotal)
              ) : showPromo && promoTotal < total ? (
                <>
                  <span className="mr-1.5 text-sm text-zinc-500 line-through">
                    {formatPrice(total)}
                  </span>
                  <span className="text-yellow-300">
                    {formatPrice(promoTotal)}
                  </span>
                </>
              ) : (
                formatPrice(total)
              )}
            </span>
          </div>
          <button
            onClick={handleProceed}
            disabled={booking || status === "loading"}
            className="w-full rounded-xl bg-emerald-600 px-6 py-3.5 font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            {booking ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Locking slots...
              </span>
            ) : isRecurring ? (
              <span className="flex items-center justify-center gap-2">
                {recurringMode === "weekly" ? <RefreshCw className="h-4 w-4" /> : <Calendar className="h-4 w-4" />}
                {currentDiscount > 0
                ? `Continue — ${formatPrice(discountedTotal)} (${currentDiscount}% off)`
                : `Continue — ${formatPrice(total)}/${recurringUnit} \u00D7 ${recurringCount} ${recurringUnitPlural}`}
              </span>
            ) : (
              "Continue"
            )}
          </button>
        </div>
      )}

      <WaitlistDialog
        isOpen={waitlistHour !== null}
        onClose={() => setWaitlistHour(null)}
        courtConfigId={configId}
        courtLabel={courtLabel}
        sport={sport}
        date={selectedDate}
        hour={waitlistHour ?? 0}
        lockDate={
          slots.find((s) => s.hour === waitlistHour)?.lockDate ?? selectedDate
        }
        lockHour={
          slots.find((s) => s.hour === waitlistHour)?.lockHour ??
          waitlistHour ??
          0
        }
      />

      {/* Soft-block alternatives sheet — opens when the user taps an
          amber tile (slot blocked on this court but free on a sibling
          court). Provides the pivot links + a "Notify me anyway"
          fall-back. Hidden entirely in mediumMode (see the SlotGrid
          prop comment above for why). */}
      <AlternativesSheet
        slot={alternativesSlot}
        sport={sport}
        selectedDate={selectedDate}
        onClose={() => setAlternativesSlot(null)}
        onNotifyMe={
          mediumMode ? undefined : (h) => setWaitlistHour(h)
        }
      />
    </div>
  );
}
