"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { DatePicker } from "@/components/booking/date-picker";
import { SlotGrid } from "@/components/booking/slot-grid";
import { CheckoutAuth } from "@/components/checkout-auth";
import { formatPrice } from "@/lib/pricing";
import { formatHour } from "@/lib/court-config";
import type { SlotAvailability } from "@/lib/availability";
import { Loader2, Bell, X, CheckCircle, RefreshCw, Calendar } from "lucide-react";
import { joinWaitlist } from "@/actions/waitlist";
import { getPublicRecurringConfig } from "@/actions/admin-recurring";
import type { RecurringTier, DailyTier } from "@/actions/admin-recurring";

interface SlotSelectionClientProps {
  configId: string;
  sport: string;
  sportName: string;
  courtLabel: string;
  courtSize: string;
  userId?: string;
  userPhone?: string;
}

interface WaitlistModalState {
  open: boolean;
  hour: number;
  phone: string;
  loading: boolean;
  success: boolean;
  error: string | null;
}

export function SlotSelectionClient({
  configId,
  userId,
  userPhone,
}: SlotSelectionClientProps) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [slots, setSlots] = useState<SlotAvailability[]>([]);
  const [selectedHours, setSelectedHours] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);
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

  // Waitlist modal state
  const [waitlist, setWaitlist] = useState<WaitlistModalState>({
    open: false,
    hour: 0,
    phone: userPhone || "",
    loading: false,
    success: false,
    error: null,
  });

  // Track which hours the user has joined the waitlist for
  const [waitlistedHours, setWaitlistedHours] = useState<Set<number>>(new Set());

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

  // Save selection to sessionStorage whenever it changes
  useEffect(() => {
    if (selectedHours.length > 0) {
      sessionStorage.setItem(storageKey, JSON.stringify({ date: selectedDate, hours: selectedHours }));
    }
  }, [selectedHours, selectedDate, storageKey]);

  // Restore selection from sessionStorage on mount (e.g. after Google OAuth redirect)
  useEffect(() => {
    const saved = sessionStorage.getItem(storageKey);
    if (saved) {
      try {
        const { date, hours } = JSON.parse(saved);
        if (date === selectedDate && Array.isArray(hours) && hours.length > 0) {
          setSelectedHours(hours);
        }
      } catch { /* ignore */ }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function fetchSlots() {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/availability?configId=${configId}&date=${selectedDate}`
        );
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
  }, [configId, selectedDate]);

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
  const total = selectedSlotPrices.reduce((sum, s) => sum + s.price, 0);

  const handleProceed = async () => {
    if (selectedHours.length === 0) return;

    // If session is still loading, wait before deciding
    if (status === "loading") return;

    // If not logged in, show inline auth
    if (status === "unauthenticated" || !session?.user) {
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
      const formData = new FormData();
      formData.set("courtConfigId", configId);
      formData.set("date", selectedDate);
      formData.set("hours", JSON.stringify(selectedHours));

      const res = await fetch("/api/booking/lock", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (data.success && data.bookingId) {
        sessionStorage.removeItem(storageKey);
        const params = new URLSearchParams({ bookingId: data.bookingId });
        if (isRecurring && selectedHours.length > 0) {
          params.set("recurring", "1");
          params.set("mode", recurringMode);
          params.set("dayOfWeek", String(effectiveRecurringDay));
          params.set("startDate", selectedDate);
          params.set("startHour", String(Math.min(...selectedHours)));
          params.set("endHour", String(Math.max(...selectedHours) + 1));
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

  const openWaitlistModal = (hour: number) => {
    setWaitlist({
      open: true,
      hour,
      phone: userPhone || "",
      loading: false,
      success: false,
      error: null,
    });
  };

  const closeWaitlistModal = () => {
    setWaitlist((prev) => ({ ...prev, open: false }));
  };

  const handleJoinWaitlist = async () => {
    setWaitlist((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const result = await joinWaitlist({
        courtConfigId: configId,
        date: selectedDate,
        startHour: waitlist.hour,
        endHour: waitlist.hour + 1,
        guestPhone: !userId ? waitlist.phone : undefined,
      });

      if (result.success) {
        setWaitlistedHours((prev) => new Set([...prev, waitlist.hour]));
        setWaitlist((prev) => ({ ...prev, loading: false, success: true }));
      } else {
        setWaitlist((prev) => ({ ...prev, loading: false, error: result.error || "Failed to join waitlist" }));
      }
    } catch {
      setWaitlist((prev) => ({ ...prev, loading: false, error: "Something went wrong" }));
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

  const unavailableSlots = slots.filter((s) => s.status === "booked" || s.status === "locked" || s.status === "blocked");

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
      <DatePicker selectedDate={selectedDate} onDateChange={(date) => {
        setSelectedDate(date);
        setSelectedHours([]);
        sessionStorage.removeItem(storageKey);
      }} />

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
          <span className="ml-2 text-zinc-400">Loading slots...</span>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-center text-red-400">
          {error}
        </div>
      ) : (
        <>
          <SlotGrid
            slots={slots}
            selectedHours={selectedHours}
            onSelectionChange={setSelectedHours}
          />

          {/* Waitlist buttons for unavailable slots */}
          {unavailableSlots.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Join Waitlist for Unavailable Slots
              </p>
              <div className="flex flex-wrap gap-2">
                {unavailableSlots.map((slot) => {
                  const isWaitlisted = waitlistedHours.has(slot.hour);
                  return (
                    <button
                      key={slot.hour}
                      onClick={() => !isWaitlisted && openWaitlistModal(slot.hour)}
                      disabled={isWaitlisted}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                        isWaitlisted
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 cursor-default"
                          : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-600 hover:text-white"
                      }`}
                    >
                      {isWaitlisted ? (
                        <CheckCircle className="h-3 w-3" />
                      ) : (
                        <Bell className="h-3 w-3" />
                      )}
                      {formatHour(slot.hour)}
                      {isWaitlisted ? " \u2014 Waitlisted" : " \u2014 Notify Me"}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Recurring Booking Toggle */}
      {selectedHours.length > 0 && !showAuth && recurringConfig?.enabled && !recurringConfigLoading && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <button
              role="switch"
              aria-checked={isRecurring}
              onClick={() => setIsRecurring(!isRecurring)}
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
                    onClick={() => setRecurringMode("weekly")}
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
                    onClick={() => setRecurringMode("daily")}
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
                          onClick={() => setWeeksCount(w)}
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
                          onClick={() => setDaysCount(d)}
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
      {showAuth && status !== "authenticated" && (
        <CheckoutAuth onAuthenticated={handleAuthenticated} />
      )}

      {/* Bottom spacer for mobile fixed bar */}
      {selectedHours.length > 0 && !showAuth && (
        <div className="h-36 md:h-0" />
      )}

      {selectedHours.length > 0 && !showAuth && (
        <div className="fixed bottom-0 left-0 right-0 z-40 md:relative md:bottom-auto md:left-auto md:right-auto md:z-auto bg-black/95 backdrop-blur-md border-t border-zinc-800 md:border-0 md:bg-transparent md:backdrop-blur-none p-4 md:p-0">
          {/* Slot summary */}
          <div className="flex items-center justify-between mb-2 md:mb-3 text-sm">
            <div className="flex items-center gap-2 text-zinc-400 overflow-hidden">
              <span className="font-medium text-white flex-shrink-0">{selectedHours.length} slot{selectedHours.length > 1 ? "s" : ""}</span>
              <span className="truncate text-xs">
                {selectedHours.sort((a, b) => a - b).map((h) => formatHour(h)).join(", ")}
              </span>
            </div>
            <span className={`font-bold flex-shrink-0 ${isRecurring && recurringMode === "daily" ? "text-blue-400" : "text-emerald-400"}`}>
              {isRecurring ? formatPrice(discountedTotal) : formatPrice(total)}
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
                ? `Proceed — ${formatPrice(discountedTotal)} (${currentDiscount}% off)`
                : `Proceed — ${formatPrice(total)}/${recurringUnit} \u00D7 ${recurringCount} ${recurringUnitPlural}`}
              </span>
            ) : (
              "Pay Now"
            )}
          </button>
        </div>
      )}

      {/* Waitlist Modal */}
      {waitlist.open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-white">Join Waitlist</h3>
                <p className="text-sm text-zinc-400 mt-0.5">
                  {formatHour(waitlist.hour)} — {formatHour(waitlist.hour + 1)}
                </p>
              </div>
              <button onClick={closeWaitlistModal} className="text-zinc-500 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            {waitlist.success ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <CheckCircle className="h-12 w-12 text-emerald-400" />
                <p className="font-medium text-white">You&apos;re on the waitlist!</p>
                <p className="text-sm text-zinc-400">
                  We&apos;ll SMS you if this slot opens up.
                </p>
                <button
                  onClick={closeWaitlistModal}
                  className="mt-2 w-full rounded-xl border border-zinc-700 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                {!userId && (
                  <div>
                    <label className="text-sm text-zinc-400">Phone number for SMS notification</label>
                    <input
                      type="tel"
                      value={waitlist.phone}
                      onChange={(e) => setWaitlist((prev) => ({ ...prev, phone: e.target.value }))}
                      placeholder="+91 98765 43210"
                      className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-white placeholder-zinc-500"
                    />
                  </div>
                )}

                {userId && (
                  <p className="text-sm text-zinc-400">
                    We&apos;ll notify you via SMS when this slot becomes available.
                  </p>
                )}

                {waitlist.error && (
                  <p className="text-sm text-red-400">{waitlist.error}</p>
                )}

                <button
                  onClick={handleJoinWaitlist}
                  disabled={waitlist.loading || (!userId && !waitlist.phone)}
                  className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {waitlist.loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Joining...
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <Bell className="h-4 w-4" />
                      Notify Me
                    </span>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
