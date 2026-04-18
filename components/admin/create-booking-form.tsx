"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  searchCustomers,
  getAvailableSlots,
  createCustomerForBooking,
  adminCreateBooking,
} from "@/actions/admin-booking";
import { SPORT_INFO, SIZE_INFO, formatHourRangeCompact, formatHoursAsRanges } from "@/lib/court-config";
import { formatPrice } from "@/lib/pricing";
import { getTodayIST } from "@/lib/ist-date";
import type { Sport, ConfigSize, CourtZone } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CourtConfigRow {
  id: string;
  sport: Sport;
  size: ConfigSize;
  label: string;
  position: string;
  widthFt: number;
  lengthFt: number;
  zones: CourtZone[];
  isActive: boolean;
}

interface SlotInfo {
  hour: number;
  price: number;
  available: boolean;
  blocked: boolean;
}

interface CustomerInfo {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

type PaymentMethod = "CASH" | "UPI_QR" | "RAZORPAY" | "FREE";

const ALL_SPORTS: Sport[] = ["CRICKET", "FOOTBALL", "BADMINTON", "PICKLEBALL"];
const SPORT_EMOJIS: Record<Sport, string> = {
  CRICKET: "\u{1F3CF}",
  FOOTBALL: "\u26BD",
  BADMINTON: "\u{1F3F8}",
  PICKLEBALL: "\u{1F3D3}",
};

const PAYMENT_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "UPI_QR", label: "UPI QR" },
  { value: "RAZORPAY", label: "Razorpay (Manual)" },
  { value: "FREE", label: "Free (Complimentary)" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CreateBookingForm({
  courtConfigs,
  prefillCourtConfigId,
  prefillDate,
  prefillHour,
}: {
  courtConfigs: CourtConfigRow[];
  prefillCourtConfigId?: string;
  prefillDate?: string;
  prefillHour?: number;
}) {
  const router = useRouter();

  // Derive prefill values from URL params
  const prefillConfig = prefillCourtConfigId
    ? courtConfigs.find((c) => c.id === prefillCourtConfigId)
    : undefined;

  // Wizard step — skip to step 2 if prefilled from calendar
  const [step, setStep] = useState(prefillConfig ? 2 : 1);

  // Step 1 state
  const [selectedSport, setSelectedSport] = useState<Sport | null>(
    prefillConfig?.sport ?? null
  );
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(
    prefillCourtConfigId ?? null
  );

  // Step 2 state
  const [date, setDate] = useState(prefillDate ?? "");
  const [slots, setSlots] = useState<SlotInfo[]>([]);
  const [selectedHours, setSelectedHours] = useState<number[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState("");

  // Step 3 state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CustomerInfo[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerInfo | null>(
    null
  );
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [createCustomerLoading, setCreateCustomerLoading] = useState(false);
  const [customerError, setCustomerError] = useState("");

  // Step 4 state
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [razorpayPaymentId, setRazorpayPaymentId] = useState("");
  const [note, setNote] = useState("");
  // Partial-payment flow: admin records how much the customer has paid
  // against the slot price (via static QR, cash in hand, or Razorpay).
  // Remainder is collected at the venue. isPartial=false means the full
  // amount behaves exactly like before.
  const [isPartial, setIsPartial] = useState(false);
  const [advanceAmountStr, setAdvanceAmountStr] = useState("");

  // Step 5 state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Track if prefilled hour has already been applied
  const prefillApplied = useRef(false);

  // Debounce ref
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  // Only show sports that have at least one active config
  const activeSports = ALL_SPORTS.filter((s) =>
    courtConfigs.some((c) => c.sport === s)
  );

  const filteredConfigs = selectedSport
    ? courtConfigs.filter((c) => c.sport === selectedSport)
    : [];

  const selectedConfig = courtConfigs.find((c) => c.id === selectedConfigId);

  const totalPrice = selectedHours.reduce((sum, h) => {
    const slot = slots.find((s) => s.hour === h);
    return sum + (slot?.price ?? 0);
  }, 0);

  const today = getTodayIST();
  const maxDate = new Date(Date.now() + 30 * 86400000)
    .toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  // ---------------------------------------------------------------------------
  // Fetch slots when date or config changes
  // ---------------------------------------------------------------------------

  const fetchSlots = useCallback(async () => {
    if (!selectedConfigId || !date) return;
    setSlotsLoading(true);
    setSlotsError("");
    setSelectedHours([]);
    try {
      const result = await getAvailableSlots(selectedConfigId, date);
      if (result.success) {
        setSlots(result.slots);
        // Auto-select prefilled hour if available (only on first load)
        if (
          !prefillApplied.current &&
          prefillHour !== undefined &&
          result.slots.some((s) => s.hour === prefillHour && s.available)
        ) {
          prefillApplied.current = true;
          setSelectedHours([prefillHour]);
        }
      } else {
        setSlotsError(result.error);
        setSlots([]);
      }
    } catch {
      setSlotsError("Failed to load slots");
      setSlots([]);
    } finally {
      setSlotsLoading(false);
    }
  }, [selectedConfigId, date]);

  useEffect(() => {
    fetchSlots();
  }, [fetchSlots]);

  // ---------------------------------------------------------------------------
  // Customer search with debounce
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const result = await searchCustomers(searchQuery.trim());
        if (result.success) {
          setSearchResults(result.customers);
        }
      } catch {
        // ignore
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchQuery]);

  // ---------------------------------------------------------------------------
  // Create new customer
  // ---------------------------------------------------------------------------

  async function handleCreateCustomer() {
    if (!newName.trim() || !newPhone.trim()) return;
    setCreateCustomerLoading(true);
    setCustomerError("");
    try {
      const result = await createCustomerForBooking({
        name: newName.trim(),
        phone: newPhone.trim(),
        email: newEmail.trim() || undefined,
      });
      if (result.success) {
        setSelectedCustomer({
          id: result.userId,
          name: newName.trim(),
          email: newEmail.trim() || null,
          phone: newPhone.trim(),
        });
        setShowNewCustomer(false);
      } else {
        setCustomerError(result.error);
      }
    } catch {
      setCustomerError("Failed to create customer");
    } finally {
      setCreateCustomerLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Submit booking
  // ---------------------------------------------------------------------------

  async function handleSubmit() {
    if (!selectedConfigId || !date || !selectedCustomer) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const parsedAdvance = isPartial ? parseInt(advanceAmountStr, 10) : NaN;
      const advanceAmount =
        isPartial && Number.isFinite(parsedAdvance) && parsedAdvance > 0
          ? parsedAdvance
          : undefined;

      const result = await adminCreateBooking({
        courtConfigId: selectedConfigId,
        date,
        hours: selectedHours.sort((a, b) => a - b),
        userId: selectedCustomer.id,
        paymentMethod,
        razorpayPaymentId:
          paymentMethod === "RAZORPAY" ? razorpayPaymentId : undefined,
        advanceAmount,
        note: note.trim() || undefined,
      });
      if (result.success) {
        router.push(`/admin/bookings/${result.bookingId}`);
      } else {
        setSubmitError(result.error);
      }
    } catch {
      setSubmitError("Failed to create booking");
    } finally {
      setSubmitting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Toggle hour selection
  // ---------------------------------------------------------------------------

  function toggleHour(hour: number) {
    setSelectedHours((prev) =>
      prev.includes(hour) ? prev.filter((h) => h !== hour) : [...prev, hour]
    );
  }

  // ---------------------------------------------------------------------------
  // Step indicators
  // ---------------------------------------------------------------------------

  const steps = [
    "Sport & Court",
    "Date & Slots",
    "Customer",
    "Payment",
    "Review",
  ];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Step indicators */}
      <div className="flex items-center gap-2">
        {steps.map((label, i) => {
          const stepNum = i + 1;
          const isActive = step === stepNum;
          const isCompleted = step > stepNum;
          return (
            <div key={label} className="flex items-center gap-2">
              {i > 0 && (
                <div
                  className={`h-px w-6 ${isCompleted ? "bg-emerald-500" : "bg-zinc-700"}`}
                />
              )}
              <div
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    : isCompleted
                      ? "bg-emerald-500/10 text-emerald-500"
                      : "bg-zinc-800 text-zinc-500"
                }`}
              >
                <span>{stepNum}</span>
                <span className="hidden sm:inline">{label}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* Step 1: Sport & Court */}
      {/* ------------------------------------------------------------------- */}
      {step === 1 && (
        <div className="space-y-6">
          {/* Sport selection */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-white">Select Sport</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {activeSports.map((sport) => {
                const info = SPORT_INFO[sport];
                const isSelected = selectedSport === sport;
                return (
                  <button
                    key={sport}
                    onClick={() => {
                      setSelectedSport(sport);
                      setSelectedConfigId(null);
                    }}
                    className={`rounded-xl border p-4 text-center transition-all ${
                      isSelected
                        ? "border-emerald-500 bg-emerald-500/10 text-white"
                        : "border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600 hover:bg-zinc-800"
                    }`}
                  >
                    <div className="text-2xl">{SPORT_EMOJIS[sport]}</div>
                    <div className="mt-1 text-sm font-medium">{info.name}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Court config selection */}
          {selectedSport && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-white">
                Select Court Configuration
              </h2>
              {filteredConfigs.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  No active configurations for this sport.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filteredConfigs.map((config) => {
                    const isSelected = selectedConfigId === config.id;
                    const sizeInfo = SIZE_INFO[config.size];
                    return (
                      <button
                        key={config.id}
                        onClick={() => setSelectedConfigId(config.id)}
                        className={`rounded-xl border p-4 text-left transition-all ${
                          isSelected
                            ? "border-emerald-500 bg-emerald-500/10"
                            : "border-zinc-700 bg-zinc-800/50 hover:border-zinc-600 hover:bg-zinc-800"
                        }`}
                      >
                        <div className="text-sm font-medium text-white">
                          {config.label}
                        </div>
                        <div className="mt-1 text-xs text-zinc-400">
                          {sizeInfo.name} &middot; {config.widthFt}ft &times;{" "}
                          {config.lengthFt}ft
                        </div>
                        <div className="mt-1 text-[10px] text-zinc-500">
                          Zones: {config.zones.join(", ")}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <button
              disabled={!selectedConfigId}
              onClick={() => setStep(2)}
              className="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* Step 2: Date & Slots */}
      {/* ------------------------------------------------------------------- */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-white">
              Select Date & Time Slots
            </h2>

            <input
              type="date"
              value={date}
              min={today}
              max={maxDate}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {date && slotsLoading && (
            <p className="text-sm text-zinc-400">Loading available slots...</p>
          )}

          {slotsError && (
            <p className="text-sm text-red-400">{slotsError}</p>
          )}

          {date && !slotsLoading && slots.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-500">
                Tap to select time slots. Green = available, Red = booked, Gray
                = blocked.
              </p>
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-10 gap-2">
                {slots.map((slot) => {
                  const isSelected = selectedHours.includes(slot.hour);
                  let classes =
                    "rounded-lg border px-2 py-2 text-xs font-medium text-center transition-all ";

                  if (slot.blocked) {
                    classes +=
                      "border-zinc-700 bg-zinc-800/40 text-zinc-600 cursor-not-allowed";
                  } else if (!slot.available) {
                    classes +=
                      "border-red-500/30 bg-red-500/10 text-red-400 cursor-not-allowed";
                  } else if (isSelected) {
                    classes +=
                      "border-emerald-500 bg-emerald-500/20 text-emerald-300 cursor-pointer";
                  } else {
                    classes +=
                      "border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:border-emerald-500/50 cursor-pointer";
                  }

                  return (
                    <button
                      key={slot.hour}
                      disabled={!slot.available}
                      onClick={() => toggleHour(slot.hour)}
                      className={classes}
                    >
                      <div>{formatHourRangeCompact(slot.hour)}</div>
                      <div className="text-[10px] mt-0.5 opacity-70">
                        {formatPrice(slot.price)}
                      </div>
                    </button>
                  );
                })}
              </div>

              {selectedHours.length > 0 && (
                <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 flex items-center justify-between">
                  <span className="text-sm text-zinc-400">
                    {selectedHours.length} slot
                    {selectedHours.length !== 1 ? "s" : ""} selected
                  </span>
                  <span className="text-lg font-bold text-emerald-400">
                    {formatPrice(totalPrice)}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between">
            <button
              onClick={() => setStep(1)}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-6 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
            >
              Back
            </button>
            <button
              disabled={selectedHours.length === 0}
              onClick={() => setStep(3)}
              className="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* Step 3: Customer */}
      {/* ------------------------------------------------------------------- */}
      {step === 3 && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-white">Select Customer</h2>

          {selectedCustomer ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">
                  {selectedCustomer.name}
                </p>
                <p className="text-xs text-zinc-400">
                  {selectedCustomer.phone}
                  {selectedCustomer.email
                    ? ` \u00B7 ${selectedCustomer.email}`
                    : ""}
                </p>
              </div>
              <button
                onClick={() => {
                  setSelectedCustomer(null);
                  setSearchQuery("");
                  setSearchResults([]);
                }}
                className="text-xs text-zinc-400 hover:text-white"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Search */}
              {!showNewCustomer && (
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Search by name, email, or phone..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
                  />
                  {searchLoading && (
                    <p className="text-xs text-zinc-500">Searching...</p>
                  )}
                  {searchResults.length > 0 && (
                    <div className="rounded-lg border border-zinc-700 bg-zinc-800 divide-y divide-zinc-700 max-h-60 overflow-y-auto">
                      {searchResults.map((customer) => (
                        <button
                          key={customer.id}
                          onClick={() => {
                            setSelectedCustomer(customer);
                            setSearchQuery("");
                            setSearchResults([]);
                          }}
                          className="w-full px-4 py-3 text-left hover:bg-zinc-700/50 transition-colors"
                        >
                          <p className="text-sm font-medium text-white">
                            {customer.name}
                          </p>
                          <p className="text-xs text-zinc-400">
                            {customer.phone}
                            {customer.email ? ` \u00B7 ${customer.email}` : ""}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                  {searchQuery.trim().length >= 2 &&
                    !searchLoading &&
                    searchResults.length === 0 && (
                      <p className="text-xs text-zinc-500">
                        No customers found.
                      </p>
                    )}
                </div>
              )}

              {/* Toggle new customer */}
              <button
                onClick={() => setShowNewCustomer(!showNewCustomer)}
                className="text-sm text-emerald-400 hover:text-emerald-300"
              >
                {showNewCustomer
                  ? "\u2190 Back to search"
                  : "+ Create new customer"}
              </button>

              {/* New customer form */}
              {showNewCustomer && (
                <div className="space-y-3 rounded-xl border border-zinc-700 bg-zinc-800/50 p-4">
                  <input
                    type="text"
                    placeholder="Name *"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
                  />
                  <input
                    type="tel"
                    placeholder="Phone *"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
                  />
                  <input
                    type="email"
                    placeholder="Email (optional)"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
                  />
                  {customerError && (
                    <p className="text-xs text-red-400">{customerError}</p>
                  )}
                  <button
                    disabled={
                      !newName.trim() ||
                      !newPhone.trim() ||
                      createCustomerLoading
                    }
                    onClick={handleCreateCustomer}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {createCustomerLoading
                      ? "Creating..."
                      : "Create Customer"}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between">
            <button
              onClick={() => setStep(2)}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-6 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
            >
              Back
            </button>
            <button
              disabled={!selectedCustomer}
              onClick={() => setStep(4)}
              className="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* Step 4: Payment */}
      {/* ------------------------------------------------------------------- */}
      {step === 4 && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-white">Payment Details</h2>

          <div className="space-y-3">
            {PAYMENT_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-center gap-3 rounded-xl border p-4 cursor-pointer transition-all ${
                  paymentMethod === opt.value
                    ? "border-emerald-500 bg-emerald-500/10"
                    : "border-zinc-700 bg-zinc-800/50 hover:border-zinc-600"
                }`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  value={opt.value}
                  checked={paymentMethod === opt.value}
                  onChange={() => setPaymentMethod(opt.value)}
                  className="accent-emerald-500"
                />
                <span className="text-sm text-white">{opt.label}</span>
              </label>
            ))}
          </div>

          {paymentMethod === "RAZORPAY" && (
            <input
              type="text"
              placeholder="Razorpay Payment ID"
              value={razorpayPaymentId}
              onChange={(e) => setRazorpayPaymentId(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
            />
          )}

          {/* Partial payment: admin records advance collected; remainder is
              owed at the venue. Not available on Free bookings. */}
          {paymentMethod !== "FREE" && (
            <div className="rounded-xl border border-zinc-700 bg-zinc-800/40 p-4 space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPartial}
                  onChange={(e) => setIsPartial(e.target.checked)}
                  className="accent-amber-400 h-4 w-4"
                />
                <span className="text-sm font-medium text-white">
                  Partial payment — collect remainder at venue
                </span>
              </label>
              {isPartial && (() => {
                const parsed = parseInt(advanceAmountStr, 10);
                const valid = Number.isFinite(parsed) && parsed > 0 && parsed < totalPrice;
                const remaining = valid ? totalPrice - parsed : 0;
                return (
                  <div className="space-y-2 pl-7">
                    <label className="block text-xs text-zinc-400">Advance paid</label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-zinc-400">₹</span>
                      <input
                        type="number"
                        min={1}
                        max={Math.max(totalPrice - 1, 1)}
                        step={1}
                        placeholder={`e.g. ${Math.ceil(totalPrice / 2)}`}
                        value={advanceAmountStr}
                        onChange={(e) => setAdvanceAmountStr(e.target.value)}
                        className="w-32 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:border-amber-400 focus:outline-none"
                      />
                      <span className="text-xs text-zinc-500">
                        via {PAYMENT_OPTIONS.find((o) => o.value === paymentMethod)?.label}
                      </span>
                    </div>
                    {advanceAmountStr && !valid && (
                      <p className="text-xs text-red-400">
                        Advance must be between ₹1 and {formatPrice(totalPrice - 1)}
                      </p>
                    )}
                    {valid && (
                      <p className="text-xs text-amber-300">
                        Remaining at venue: <span className="font-semibold">{formatPrice(remaining)}</span>
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 flex items-center justify-between">
            <span className="text-sm text-zinc-400">Total Amount</span>
            <span className="text-lg font-bold text-emerald-400">
              {paymentMethod === "FREE"
                ? "\u20B90"
                : formatPrice(totalPrice)}
            </span>
          </div>

          <textarea
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none resize-none"
          />

          <div className="flex justify-between">
            <button
              onClick={() => setStep(3)}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-6 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
            >
              Back
            </button>
            <button
              onClick={() => setStep(5)}
              className="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* Step 5: Review */}
      {/* ------------------------------------------------------------------- */}
      {step === 5 && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-white">Review Booking</h2>

          <div className="rounded-xl border border-zinc-700 bg-zinc-800/50 divide-y divide-zinc-700">
            {/* Sport & Court */}
            <div className="p-4">
              <p className="text-xs text-zinc-500 uppercase tracking-wide">
                Court
              </p>
              <p className="text-sm font-medium text-white mt-1">
                {selectedSport && SPORT_EMOJIS[selectedSport]}{" "}
                {selectedConfig
                  ? `${SPORT_INFO[selectedConfig.sport].name} \u2014 ${selectedConfig.label}`
                  : ""}
              </p>
              <p className="text-xs text-zinc-400">
                {selectedConfig
                  ? `${SIZE_INFO[selectedConfig.size].name} \u00B7 ${selectedConfig.widthFt}ft \u00D7 ${selectedConfig.lengthFt}ft`
                  : ""}
              </p>
            </div>

            {/* Date & Slots */}
            <div className="p-4">
              <p className="text-xs text-zinc-500 uppercase tracking-wide">
                Date & Slots
              </p>
              <p className="text-sm font-medium text-white mt-1">{date}</p>
              <p className="text-xs text-zinc-400 mt-0.5">
                {formatHoursAsRanges([...selectedHours].sort((a, b) => a - b))}
              </p>
            </div>

            {/* Customer */}
            <div className="p-4">
              <p className="text-xs text-zinc-500 uppercase tracking-wide">
                Customer
              </p>
              <p className="text-sm font-medium text-white mt-1">
                {selectedCustomer?.name}
              </p>
              <p className="text-xs text-zinc-400">
                {selectedCustomer?.phone}
                {selectedCustomer?.email
                  ? ` \u00B7 ${selectedCustomer.email}`
                  : ""}
              </p>
            </div>

            {/* Payment */}
            <div className="p-4">
              <p className="text-xs text-zinc-500 uppercase tracking-wide">
                Payment
              </p>
              <p className="text-sm font-medium text-white mt-1">
                {PAYMENT_OPTIONS.find((o) => o.value === paymentMethod)?.label}
                {isPartial && advanceAmountStr && " \u00B7 Partial"}
              </p>
              {paymentMethod === "RAZORPAY" && razorpayPaymentId && (
                <p className="text-xs text-zinc-400">
                  ID: {razorpayPaymentId}
                </p>
              )}
              <p className="text-lg font-bold text-emerald-400 mt-1">
                {paymentMethod === "FREE"
                  ? "\u20B90"
                  : formatPrice(totalPrice)}
              </p>
              {isPartial && advanceAmountStr && (() => {
                const parsed = parseInt(advanceAmountStr, 10);
                if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= totalPrice) return null;
                const remaining = totalPrice - parsed;
                return (
                  <div className="mt-2 space-y-0.5 text-xs">
                    <p className="text-emerald-300">Advance collected: <span className="font-semibold">{formatPrice(parsed)}</span></p>
                    <p className="text-amber-300">Due at venue: <span className="font-semibold">{formatPrice(remaining)}</span></p>
                  </div>
                );
              })()}
            </div>

            {/* Note */}
            {note.trim() && (
              <div className="p-4">
                <p className="text-xs text-zinc-500 uppercase tracking-wide">
                  Note
                </p>
                <p className="text-sm text-zinc-300 mt-1">{note}</p>
              </div>
            )}
          </div>

          {submitError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
              <p className="text-sm text-red-400">{submitError}</p>
            </div>
          )}

          <div className="flex justify-between">
            <button
              onClick={() => setStep(4)}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-6 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
            >
              Back
            </button>
            <button
              disabled={submitting}
              onClick={handleSubmit}
              className="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? "Creating..." : "Create Booking"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
