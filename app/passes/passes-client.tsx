"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Clock,
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
  Users,
  Sun,
  Moon,
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
import { PromoBannerStrip, type PromoBannerData } from "@/components/promo-banner-strip";
import {
  trackPassPurchaseStarted,
  trackPassPurchaseCompleted,
} from "@/lib/analytics";

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
  timeChips: { label: string; tone: "day" | "night" }[];
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

// Tiny chip used in the how-it-works mini-visuals.
function StepChip({
  children,
  tone = "zinc",
}: {
  children: ReactNode;
  tone?: "zinc" | "emerald";
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${
        tone === "emerald"
          ? "bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/25"
          : "bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700"
      }`}
    >
      {children}
    </span>
  );
}

// How-it-works steps — icon + copy + a mini-visual that SHOWS the step
// (a pass chip, the shared squad, a matched slot, the ₹0 debit).
const STEPS = [
  {
    icon: Ticket,
    title: "Buy a pass",
    desc: "Pick your sport and a bundle of hours, pay once — UPI or card. The hours land on your account instantly, at a cheaper rate than booking slot by slot.",
    visual: (
      <>
        <StepChip tone="emerald">
          <Ticket className="h-3 w-3" /> 10 hours
        </StepChip>
        <StepChip>Save 15%</StepChip>
      </>
    ),
  },
  {
    icon: Users,
    title: "Share with your squad",
    desc: "These are team sports — so share the pass. Add friends by phone number and everyone on it can book with the same hours. You stay in charge of who's in.",
    visual: (
      <>
        <span className="flex -space-x-2">
          {["A", "R", "S"].map((ch) => (
            <span
              key={ch}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-[10px] font-bold text-emerald-300 ring-2 ring-zinc-900"
            >
              {ch}
            </span>
          ))}
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-bold text-zinc-400 ring-2 ring-zinc-900">
            +2
          </span>
        </span>
        <span className="text-[11px] text-zinc-500">
          not signed up? invite on WhatsApp
        </span>
      </>
    ),
  },
  {
    icon: CalendarDays,
    title: "Book as usual",
    desc: "Nothing new to learn — pick a date and slots like any booking. When the slot matches your pass (right court, right hours), the pass offers itself at checkout.",
    visual: (
      <>
        <StepChip>Sat · 7–8pm</StepChip>
        <StepChip tone="emerald">
          <Check className="h-3 w-3" /> pass applies
        </StepChip>
      </>
    ),
  },
  {
    icon: Wallet,
    title: "Hours pay, not money",
    desc: "Tap “Book with my pass” and hours are deducted instead of rupees. Booking longer than your balance? The pass covers its share — you pay only the difference.",
    visual: (
      <>
        <StepChip tone="emerald">₹0 to pay</StepChip>
        <StepChip>10h → 9h</StepChip>
      </>
    ),
  },
];

// Terms grouped by theme so the policy reads as three short stories
// instead of one wall of bullets.
const TERM_GROUPS = [
  {
    icon: Users,
    heading: "Owning & sharing your pass",
    items: [
      "The pass belongs to the account that buys it — it can't be transferred or resold.",
      "The owner can share the pass with members (up to the limit set for that sport) by their registered phone number, and can add or remove them anytime. Members can book with the pass but can't edit the member list.",
      "Everyone books from the same shared balance — hours used by any member come off the same pass.",
    ],
  },
  {
    icon: Clock,
    heading: "Where the hours work",
    items: [
      "Hours are valid only for the court / sub-sport on the pass, and only on its pricing band (e.g. “Off-peak · all week”). Slots outside the band are charged normally.",
      "The pass covers bookings played between its start date and expiry — you can book ahead for any date inside that window.",
      "If a booking is longer than your remaining balance, the pass covers what it can and the difference is payable online.",
      "Passes can't be combined with coupons or Momentum Points.",
      "Slots remain subject to availability — a pass doesn't reserve any specific slot in advance.",
    ],
  },
  {
    icon: ShieldCheck,
    heading: "Expiry, cancellations & refunds",
    items: [
      "The pass expires at the end of its validity window — unused hours lapse and aren't refunded.",
      "Cancel a pass-paid booking within the allowed cancellation window and the hours return to your pass (validity unchanged). Late cancellations forfeit the hours.",
      "Passes are non-refundable once purchased. For exceptional cases contact the venue.",
    ],
  },
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
  promoBanners = [],
}: {
  enabled: boolean;
  plans: Plan[];
  /** UPI (PhonePe Dynamic QR) available at checkout — env creds present
   *  AND the admin toggle on. When false the pass buys Razorpay-only. */
  dqrEnabled: boolean;
  promoBanners?: PromoBannerData[];
}) {
  const router = useRouter();
  const [buying, setBuying] = useState<string | null>(null);
  // Sport filter — chips above the grid; "ALL" shows everything.
  const [sportFilter, setSportFilter] = useState<string>("ALL");
  const sports = Array.from(new Set(plans.map((p) => p.sport)));
  const shownPlans =
    sportFilter === "ALL" ? plans : plans.filter((p) => p.sport === sportFilter);
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
    trackPassPurchaseStarted(
      plan.id,
      plan.price,
      method === "upi" ? "upi" : "razorpay",
    );
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
          if (v.ok) {
            trackPassPurchaseCompleted(plan.id, plan.price, "razorpay");
            router.refresh();
          } else
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
            Passes 🎟️
          </h1>
          <p className="mt-2 max-w-xl text-zinc-400">
            {enabled
              ? "Buy hours in bulk at a lower per-hour rate, then book as usual — your pass pays instead of your wallet."
              : "Pass sales are paused right now. Any passes you already own keep working at checkout."}
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-10 px-4 py-8 sm:px-6">
        {/* Admin-managed promotion banners for this screen. */}
        <PromoBannerStrip banners={promoBanners} />
        {/* Plans — hidden entirely while the storefront is disabled. Your
            own passes now live on the account dashboard. */}
        {!enabled && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-zinc-400">
            Passes aren&apos;t available at the moment — check back soon,
            or follow us for announcements.
          </section>
        )}
        {enabled && (
        <section>
          {plans.length === 0 ? (
            <p className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-zinc-400">
              No passes on sale right now — check back soon.
            </p>
          ) : (
            <>
            {sports.length > 1 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {["ALL", ...sports].map((sp) => {
                  const on = sportFilter === sp;
                  const chipAccent = sp === "ALL" ? "#a1a1aa" : SPORT_ACCENT[sp] ?? "#34d399";
                  return (
                    <button
                      key={sp}
                      onClick={() => setSportFilter(sp)}
                      className="rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors"
                      style={
                        on
                          ? { borderColor: chipAccent, backgroundColor: `${chipAccent}26`, color: chipAccent }
                          : { borderColor: "#3f3f46", color: "#a1a1aa" }
                      }
                    >
                      {sp === "ALL" ? "All sports" : sp.charAt(0) + sp.slice(1).toLowerCase()}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {shownPlans.map((plan) => {
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
                  {/* Ticket stub — single dense row (icon | label +
                      name | hours dial), the same layout as the app's
                      PlanCard so the two surfaces read identically and
                      the header carries no dead space. Name keeps a
                      2-line reservation so every card's perforation
                      sits at the same height. */}
                  <div
                    className="relative px-4 py-4"
                    style={{
                      background: `linear-gradient(135deg, ${accent}22, transparent 70%)`,
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                        style={{ backgroundColor: `${accent}1f` }}
                      >
                        <SportIcon size={26} color={accent} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                          {plan.sport.charAt(0) + plan.sport.slice(1).toLowerCase()}
                          {plan.isBowling ? " · Bowling Machine" : ""}
                        </p>
                        <p className="mt-0.5 min-h-[2.75rem] text-base font-bold leading-snug text-white [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
                          {plan.name}
                        </p>
                      </div>
                      {/* Hours dial — the ring sweeps to the pass's
                          full hours when the card scrolls into view. */}
                      <div className="shrink-0">
                        <PassClock
                          totalHours={plan.hours}
                          accent={accent}
                          size={74}
                          stroke={7}
                          trigger="inview"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Perforation — notches + dashed divider */}
                  <div className="relative">
                    <div className="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-black" />
                    <div className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-black" />
                    <div className="border-t border-dashed border-zinc-700" />
                  </div>

                  {/* Body */}
                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-bold text-white">
                        {inr(plan.price)}
                      </span>
                      <span className="text-sm text-zinc-500 line-through">
                        {inr(plan.baseAmount)}
                      </span>
                    </div>
                    <p
                      className="mt-1 min-h-[2.5rem] text-sm font-medium leading-5"
                      style={{ color: accent }}
                    >
                      {inr(plan.effectiveHourly)}/hr
                      <span className="text-zinc-500">
                        {" "}
                        instead of {inr(plan.anchorPricePerHour)}/hr
                      </span>
                    </p>

                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-zinc-400">
                      <span className="inline-flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5" /> Valid{" "}
                        {plan.validityDays} days
                      </span>
                      {plan.timeChips.length > 0
                        ? plan.timeChips.map((c) => (
                            <span
                              key={c.label}
                              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                                c.tone === "day"
                                  ? "bg-sky-500/15 text-sky-300"
                                  : "bg-zinc-700/60 text-zinc-300"
                              }`}
                            >
                              {c.tone === "day" ? (
                                <Sun className="h-4.5 w-4.5 text-sky-300" />
                              ) : (
                                <Moon className="h-4.5 w-4.5 text-zinc-300" />
                              )}{" "}
                              {c.label}
                            </span>
                          ))
                        : isRestricted(plan.bandsSummary) && (
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
            </>
          )}
          {error && <p className="mt-3 text-sm text-amber-300">{error}</p>}
        </section>
        )}

        {/* How it works — numbered stepper with icon badges, a subtle
            connector line on desktop, and a mini-visual per step that
            SHOWS the idea (pass chip / squad avatars / matched slot /
            ₹0 debit). */}
        {enabled && (
        <section>
          <h2 className="text-lg font-semibold text-white">How it works</h2>
          <p className="mb-4 mt-1 text-sm text-zinc-500">
            Buy hours once, share them with your squad, and let the pass pay
            at checkout.
          </p>
          <ol className="relative grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Connector — sits at badge-centre height, visible only in
                the gaps between the (opaque-topped) step cards. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-[44px] hidden h-px bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent lg:block"
            />
            {STEPS.map(({ icon: Icon, title, desc, visual }, i) => (
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
                <p className="mt-1.5 pb-4 text-sm leading-relaxed text-zinc-400">
                  {desc}
                </p>
                {/* Mini-visual — pinned to the card bottom so the row of
                    footers lines up across steps. */}
                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-zinc-800/60 pt-3.5">
                  {visual}
                </div>
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
            <div className="divide-y divide-zinc-800/70 overflow-hidden rounded-b-2xl border border-t-0 border-zinc-800 bg-zinc-900/30">
              {/* Grouped by theme — three short stories instead of one
                  wall of bullets. */}
              {TERM_GROUPS.map(({ icon: GroupIcon, heading, items }) => (
                <div key={heading} className="px-4 py-4">
                  <p className="flex items-center gap-2 text-[13px] font-semibold text-zinc-200">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 ring-1 ring-emerald-500/20">
                      <GroupIcon className="h-3.5 w-3.5 text-emerald-400" />
                    </span>
                    {heading}
                  </p>
                  <ul className="mt-2.5 space-y-2">
                    {items.map((t) => (
                      <li
                        key={t}
                        className="flex gap-3 text-sm leading-relaxed text-zinc-400"
                      >
                        <span
                          aria-hidden
                          className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500/70"
                        />
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Payment-method chooser — UPI pre-selected, Razorpay one tap
          away. Mirrors the booking checkout's method nudge. */}
      {chooserPlan && (
        <div
          // z-[80] — must sit ABOVE the mobile bottom nav (z-50) and its
          // raised FAB (z-[70]), which otherwise paint over the sheet's
          // pay buttons. Safe-area padding keeps the last button clear
          // of the home indicator; max-h + scroll saves small phones.
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 sm:items-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setChooserPlan(null);
          }}
        >
          <div
            className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl border border-zinc-800 bg-zinc-900 text-zinc-100 sm:max-h-none sm:max-w-[400px] sm:rounded-2xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
          >
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
                {/* iOS Safari gives date inputs its own inner layout —
                    it ignores padding, collapses the height and centres
                    the value with UA margins, which reads as a squashed
                    / misaligned box. appearance-none + a fixed height +
                    the -webkit-date-and-time-value overrides pin the
                    rendering to match every other field. */}
                <input
                  type="date"
                  value={startDate}
                  min={minStart}
                  max={maxStart}
                  onChange={(e) => setStartDate(e.target.value || minStart)}
                  className="block h-11 w-full appearance-none rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-left text-sm text-white focus:border-emerald-500 focus:outline-none [color-scheme:dark] [&::-webkit-date-and-time-value]:m-0 [&::-webkit-date-and-time-value]:text-left [&::-webkit-datetime-edit]:p-0 [&::-webkit-calendar-picker-indicator]:opacity-70"
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
            trackPassPurchaseCompleted(dqrPlan.id, dqrPlan.price, "upi");
            setDqrPlan(null);
            router.refresh();
          }}
          onCancel={() => setDqrPlan(null)}
        />
      )}
    </div>
  );
}
