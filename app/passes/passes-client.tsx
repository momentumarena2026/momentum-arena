"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ShieldCheck,
  ChevronDown,
  Smartphone,
  CreditCard,
  Check,
  X,
  Ticket,
  CalendarDays,
  Wallet,
  ScrollText,
} from "lucide-react";
import {
  MdSportsCricket,
  MdSportsSoccer,
  MdSportsTennis,
} from "react-icons/md";
import { GiCricketBat } from "react-icons/gi";
import type { IconType } from "react-icons";
import { DqrCheckout } from "@/components/payment/dqr-checkout";
import { PassClock } from "@/components/passes/pass-clock";

// Sport → illustration + accent colour for the ticket cards. Bowling
// Machine (a cricket sub-sport) gets its own bat-and-ball glyph.
const SPORT_ICON: Record<string, IconType> = {
  CRICKET: MdSportsCricket,
  FOOTBALL: MdSportsSoccer,
  PICKLEBALL: MdSportsTennis,
};
const SPORT_ACCENT: Record<string, string> = {
  CRICKET: "#34d399", // emerald
  FOOTBALL: "#60a5fa", // blue
  PICKLEBALL: "#facc15", // yellow
};

interface Plan {
  id: string;
  name: string;
  sport: string;
  courtLabel: string;
  isBowling: boolean;
  hours: number;
  baseAmount: number;
  price: number;
  discountPercent: number;
  anchorPricePerHour: number;
  effectiveHourly: number;
  validityDays: number;
  bandsSummary: string;
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
/** A pass with no band restriction summarises as "All hours" — no badge
 *  needed for those. */
const isRestricted = (s: string) => !!s && s !== "All hours";

/** Today (+offset) as YYYY-MM-DD in IST — for the start-date picker
 *  bounds. */
function istDateStr(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString(
    "en-CA",
    { timeZone: "Asia/Kolkata" },
  );
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

// How-it-works steps — icon + copy for the numbered stepper.
const STEPS = [
  {
    icon: Ticket,
    title: "Buy a pass",
    desc: "Pick a pass for your sport and pay online — hours land on your account instantly.",
  },
  {
    icon: CalendarDays,
    title: "Book as usual",
    desc: "Choose your date and slots exactly like a normal booking.",
  },
  {
    icon: Wallet,
    title: "Pay with hours",
    desc: "At checkout, choose “Use my pass” — hours are deducted instead of money. If the booking is longer than your balance, pay just the difference.",
  },
] as const;

const TERMS = [
  "A pass is linked to the account that buys it and can't be transferred or shared.",
  "Hours are valid only for the specific court / sub-sport shown on the pass.",
  "The pass expires on its validity date — unused hours lapse and aren't refunded.",
  "Passes are non-refundable once purchased. For exceptional cases contact the venue.",
  "If a pass-paid booking is cancelled within the allowed cancellation window, the hours return to your pass (validity unchanged). Late cancellations forfeit the hours.",
  "If a booking is longer than your remaining balance, the pass covers what it can and the difference is payable online.",
  "Slots remain subject to availability — a pass doesn't reserve any specific slot in advance.",
];

/**
 * Customer passes page: plan cards with the effective-hourly-rate
 * story ("₹1,900/hr instead of ₹2,000/hr"), the signed-in user's
 * passes with live balances, how-it-works, and T&C.
 */
export function PassesClient({
  enabled,
  plans,
  dqrEnabled,
}: {
  enabled: boolean;
  plans: Plan[];
  /** UPI (PhonePe Dynamic QR) available at checkout — env creds present
   *  AND the admin toggle on. When false the pass buys Razorpay-only. */
  dqrEnabled: boolean;
}) {
  const router = useRouter();
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [termsOpen, setTermsOpen] = useState(false);
  // The plan whose method chooser is open, the selected method, and —
  // once UPI is confirmed — the plan whose DQR sheet is showing.
  const [chooserPlan, setChooserPlan] = useState<Plan | null>(null);
  const [method, setMethod] = useState<"upi" | "gateway">("upi");
  const [dqrPlan, setDqrPlan] = useState<Plan | null>(null);
  // Chosen activation date (YYYY-MM-DD, IST). Defaults to today; the pass
  // activates then and validity counts from it.
  const [startDate, setStartDate] = useState(istDateStr());
  const minStart = istDateStr();
  const maxStart = istDateStr(90);
  // Stable object so the DQR sheet doesn't re-initiate on re-render.
  const dqrExtra = useMemo(() => ({ startDate }), [startDate]);

  // "Buy pass" entry — always opens the sheet (so the customer can pick a
  // start date); UPI is pre-selected when available, else Razorpay only.
  function startBuy(plan: Plan) {
    setError(null);
    setStartDate(istDateStr());
    setMethod(dqrEnabled ? "upi" : "gateway");
    setChooserPlan(plan);
  }

  // Commit the chooser: UPI opens the DQR sheet, gateway opens Razorpay.
  function confirmMethod() {
    const plan = chooserPlan;
    if (!plan) return;
    setChooserPlan(null);
    if (method === "upi") {
      setDqrPlan(plan);
    } else {
      buy(plan);
    }
  }

  async function buy(plan: Plan) {
    setError(null);
    setBuying(plan.id);
    try {
      const res = await fetch("/api/passes/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id, startDate }),
      });
      if (res.status === 401) {
        router.push(`/login?callbackUrl=${encodeURIComponent("/passes")}`);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't start payment");

      if (!(await loadRazorpayScript()))
        throw new Error("Couldn't load the payment window");

      const rzp = new window.Razorpay({
        key: data.keyId,
        amount: Math.round(data.amount * 100),
        currency: "INR",
        name: "Momentum Arena",
        description: data.planName,
        order_id: data.orderId,
        theme: { color: "#10b981" },
        handler: async (resp: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          const v = await fetch("/api/passes/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              planId: plan.id,
              razorpayOrderId: resp.razorpay_order_id,
              razorpayPaymentId: resp.razorpay_payment_id,
              razorpaySignature: resp.razorpay_signature,
              startDate,
            }),
          });
          if (v.ok) router.refresh();
          else
            setError(
              "Payment received — your pass will appear shortly (auto-verifying).",
            );
        },
        modal: { ondismiss: () => setBuying(null) },
      });
      rzp.open();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBuying(null);
    }
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Hero */}
      <div className="border-b border-emerald-800/20 bg-gradient-to-br from-emerald-900/30 via-black to-black">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
          <h1 className="text-3xl font-bold text-white sm:text-4xl">
            Monthly Passes 🎟️
          </h1>
          <p className="mt-2 max-w-xl text-zinc-400">
            {enabled
              ? "Buy hours in bulk at a lower per-hour rate, then book as usual — your pass pays instead of your wallet."
              : "Pass sales are paused right now. Any passes you already own keep working at checkout."}
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-10 px-4 py-8 sm:px-6">
        {/* Plans — hidden entirely while the storefront is disabled. Your
            own passes now live on the account dashboard. */}
        {!enabled && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-zinc-400">
            Monthly passes aren&apos;t available at the moment — check back
            soon, or follow us for announcements.
          </section>
        )}
        {enabled && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-white">
            Available passes
          </h2>
          {plans.length === 0 ? (
            <p className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-zinc-400">
              No passes on sale right now — check back soon.
            </p>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((plan) => {
                const accent =
                  SPORT_ACCENT[plan.sport] ?? "#34d399";
                const SportIcon = plan.isBowling
                  ? GiCricketBat
                  : SPORT_ICON[plan.sport] ?? MdSportsCricket;
                return (
                <div
                  key={plan.id}
                  className="group relative flex flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 transition-all hover:-translate-y-0.5 hover:shadow-xl"
                  style={{ boxShadow: `0 0 0 1px ${accent}12` }}
                >
                  {/* Ticket stub — coloured header band with the sport
                      illustration + perforation line, so the card reads
                      as an actual pass/ticket. */}
                  <div
                    className="relative px-5 pb-5 pt-5"
                    style={{
                      background: `linear-gradient(135deg, ${accent}22, transparent 70%)`,
                    }}
                  >
                    <div className="flex items-start justify-between">
                      <div
                        className="flex h-12 w-12 items-center justify-center rounded-xl"
                        style={{ backgroundColor: `${accent}1f` }}
                      >
                        <SportIcon size={28} color={accent} />
                      </div>
                      <span
                        className="rounded-full px-2.5 py-1 text-xs font-bold"
                        style={{ backgroundColor: `${accent}22`, color: accent }}
                      >
                        Save {plan.discountPercent}%
                      </span>
                    </div>
                    <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                      {plan.sport.charAt(0) + plan.sport.slice(1).toLowerCase()}
                      {plan.isBowling ? " · Bowling Machine" : ""}
                    </p>
                    <p className="mt-0.5 text-lg font-bold leading-tight text-white">
                      {plan.name}
                    </p>
                  </div>

                  {/* Perforation — notches + dashed divider */}
                  <div className="relative">
                    <div className="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-black" />
                    <div className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-black" />
                    <div className="border-t border-dashed border-zinc-700" />
                  </div>

                  {/* Body */}
                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-bold text-white">
                            {inr(plan.price)}
                          </span>
                          <span className="text-sm text-zinc-500 line-through">
                            {inr(plan.baseAmount)}
                          </span>
                        </div>
                        <p
                          className="mt-1 text-sm font-medium"
                          style={{ color: accent }}
                        >
                          {inr(plan.effectiveHourly)}/hr
                          <span className="block text-zinc-500">
                            instead of {inr(plan.anchorPricePerHour)}/hr
                          </span>
                        </p>
                      </div>
                      {/* Clock — sweeps to the pass's full hours when the
                          card scrolls into view. */}
                      <PassClock
                        totalHours={plan.hours}
                        accent={accent}
                        size={84}
                        stroke={8}
                        trigger="inview"
                      />
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-zinc-400">
                      <span className="inline-flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5" /> Valid{" "}
                        {plan.validityDays} days
                      </span>
                      {isRestricted(plan.bandsSummary) && (
                        <span
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          style={{ backgroundColor: `${accent}1f`, color: accent }}
                        >
                          {plan.bandsSummary}
                        </span>
                      )}
                    </div>

                    {/* mt-auto pins the button to the card bottom so the
                        row of cards has aligned CTAs regardless of how
                        much meta (band chip, wrapped price) sits above. */}
                    <div className="mt-auto pt-4">
                      <button
                        onClick={() => startBuy(plan)}
                        disabled={buying === plan.id}
                        className="w-full rounded-xl py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                        style={{ backgroundColor: accent, color: "#04140d" }}
                      >
                        {buying === plan.id ? "Opening payment…" : "Buy pass"}
                      </button>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
          {error && <p className="mt-3 text-sm text-amber-300">{error}</p>}
        </section>
        )}

        {/* How it works — numbered stepper with icon badges + a subtle
            connector line that threads the three steps on desktop. */}
        {enabled && (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-white">How it works</h2>
          <ol className="relative grid gap-4 sm:grid-cols-3">
            {/* Connector — sits at badge-centre height, visible only in
                the gaps between the (opaque-topped) step cards. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-[44px] hidden h-px bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent sm:block"
            />
            {STEPS.map(({ icon: Icon, title, desc }, i) => (
              <li
                key={title}
                className="group relative flex flex-col rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-900/40 p-5 transition-colors hover:border-emerald-500/40"
              >
                <span className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/25">
                  <Icon className="h-5 w-5 text-emerald-400" />
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-black shadow-lg shadow-emerald-500/30">
                    {i + 1}
                  </span>
                </span>
                <p className="mt-4 text-base font-semibold text-white">{title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
                  {desc}
                </p>
              </li>
            ))}
          </ol>
        </section>
        )}

        {/* Terms */}
        <section className="pb-10">
          <button
            onClick={() => setTermsOpen((o) => !o)}
            aria-expanded={termsOpen}
            className={`flex w-full items-center justify-between gap-3 border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-900/40 px-4 py-3.5 text-left transition-colors hover:border-zinc-700 ${
              termsOpen ? "rounded-t-2xl border-b-0" : "rounded-2xl"
            }`}
          >
            <span className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/20">
                <ScrollText className="h-4 w-4 text-emerald-400" />
              </span>
              <span className="font-medium text-white">
                Terms, conditions &amp; policies
              </span>
            </span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${termsOpen ? "rotate-180" : ""}`}
            />
          </button>
          {termsOpen && (
            <ul className="divide-y divide-zinc-800/70 overflow-hidden rounded-b-2xl border border-t-0 border-zinc-800 bg-zinc-900/30">
              {TERMS.map((t) => (
                <li
                  key={t}
                  className="flex gap-3 px-4 py-3 text-sm leading-relaxed text-zinc-400"
                >
                  <span
                    aria-hidden
                    className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500/70"
                  />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Payment-method chooser — UPI pre-selected, Razorpay one tap
          away. Mirrors the booking checkout's method nudge. */}
      {chooserPlan && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setChooserPlan(null);
          }}
        >
          <div className="w-full rounded-t-2xl border border-zinc-800 bg-zinc-900 text-zinc-100 sm:max-w-[400px] sm:rounded-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold leading-tight text-white">
                  Choose payment method
                </p>
                <p className="truncate text-xs text-zinc-400">
                  {chooserPlan.name}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-[15px] font-semibold text-white">
                  {inr(chooserPlan.price)}
                </span>
                <button
                  onClick={() => setChooserPlan(null)}
                  aria-label="Close"
                  className="rounded-full p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="space-y-2.5 p-4">
              {/* Start date — the pass activates on this day; validity
                  counts from here. Defaults to today. */}
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-400">
                  Pass start date
                </span>
                <input
                  type="date"
                  value={startDate}
                  min={minStart}
                  max={maxStart}
                  onChange={(e) => setStartDate(e.target.value || minStart)}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none [color-scheme:dark]"
                />
                <span className="mt-1 block text-[11px] text-zinc-500">
                  Valid {chooserPlan.validityDays} days from this date · defaults
                  to today.
                </span>
              </label>

              {dqrEnabled && (
                <button
                  onClick={() => setMethod("upi")}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors ${
                    method === "upi"
                      ? "border-emerald-500 bg-emerald-500/10"
                      : "border-zinc-800 hover:bg-zinc-800/50"
                  }`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15">
                    <Smartphone className="h-5 w-5 text-emerald-400" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">
                        UPI
                      </span>
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                        Recommended
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-zinc-400">
                      Scan a QR / pay from any UPI app — no extra charge
                    </span>
                  </span>
                  {method === "upi" && (
                    <Check className="h-5 w-5 shrink-0 text-emerald-400" />
                  )}
                </button>
              )}

              <button
                onClick={() => setMethod("gateway")}
                className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors ${
                  method === "gateway"
                    ? "border-emerald-500 bg-emerald-500/10"
                    : "border-zinc-800 hover:bg-zinc-800/50"
                }`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800">
                  <CreditCard className="h-5 w-5 text-zinc-300" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-white">
                    Card / Netbanking / Wallet
                  </span>
                  <span className="mt-0.5 block text-xs text-zinc-400">
                    Pay securely via Razorpay
                  </span>
                </span>
                {method === "gateway" && (
                  <Check className="h-5 w-5 shrink-0 text-emerald-400" />
                )}
              </button>

              <button
                onClick={confirmMethod}
                className="mt-1.5 w-full rounded-xl bg-emerald-600 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-emerald-500"
              >
                Pay {inr(chooserPlan.price)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* UPI (Dynamic QR) sheet — surface="pass" hits the pass-initiate /
          pass-status routes; holdId carries the PassPlan id and the
          settled id is the new UserPass. */}
      {dqrPlan && (
        <DqrCheckout
          surface="pass"
          holdId={dqrPlan.id}
          amount={dqrPlan.price}
          initiateExtra={dqrExtra}
          onConfirmed={() => {
            setDqrPlan(null);
            router.refresh();
          }}
          onCancel={() => setDqrPlan(null)}
        />
      )}
    </div>
  );
}
