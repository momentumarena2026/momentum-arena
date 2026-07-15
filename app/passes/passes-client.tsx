"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ticket, Clock, ShieldCheck, ChevronDown } from "lucide-react";

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
}
interface MyPass {
  id: string;
  name: string;
  sport: string;
  totalMinutes: number;
  remainingMinutes: number;
  purchasedAt: string;
  expiresAt: string;
  status: string;
  redemptions: { minutes: number; createdAt: string; restored: boolean }[];
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

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
  plans,
  myPasses,
}: {
  plans: Plan[];
  myPasses: MyPass[];
}) {
  const router = useRouter();
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [termsOpen, setTermsOpen] = useState(false);

  async function buy(plan: Plan) {
    setError(null);
    setBuying(plan.id);
    try {
      const res = await fetch("/api/passes/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id }),
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

  const active = myPasses.filter((p) => p.status === "ACTIVE");

  return (
    <div className="min-h-screen bg-black">
      {/* Hero */}
      <div className="border-b border-emerald-800/20 bg-gradient-to-br from-emerald-900/30 via-black to-black">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
          <h1 className="text-3xl font-bold text-white sm:text-4xl">
            Monthly Passes 🎟️
          </h1>
          <p className="mt-2 max-w-xl text-zinc-400">
            Buy hours in bulk at a lower per-hour rate, then book as usual —
            your pass pays instead of your wallet.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-10 px-4 py-8 sm:px-6">
        {/* My passes */}
        {myPasses.length > 0 && (
          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">Your passes</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {myPasses.map((p) => {
                const usedPct = Math.round(
                  ((p.totalMinutes - p.remainingMinutes) / p.totalMinutes) * 100,
                );
                return (
                  <div
                    key={p.id}
                    className={`rounded-xl border p-4 ${
                      p.status === "ACTIVE"
                        ? "border-emerald-500/30 bg-emerald-500/5"
                        : "border-zinc-800 bg-zinc-900/50 opacity-70"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-white">{p.name}</p>
                      <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">
                        {p.status}
                      </span>
                    </div>
                    <p className="mt-2 text-2xl font-bold text-emerald-400">
                      {(p.remainingMinutes / 60).toFixed(1).replace(/\.0$/, "")}h
                      <span className="text-sm font-normal text-zinc-500">
                        {" "}
                        / {p.totalMinutes / 60}h left
                      </span>
                    </p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${100 - usedPct}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-zinc-500">
                      Expires{" "}
                      {new Date(p.expiresAt).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Plans */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-white">
            {active.length > 0 ? "Buy another pass" : "Available passes"}
          </h2>
          {plans.length === 0 ? (
            <p className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-zinc-400">
              No passes on sale right now — check back soon.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((plan) => (
                <div
                  key={plan.id}
                  className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 transition-colors hover:border-emerald-600/40"
                >
                  <div className="flex items-center gap-2">
                    <Ticket className="h-5 w-5 text-emerald-400" />
                    <p className="font-semibold text-white">{plan.name}</p>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {plan.courtLabel}
                    {plan.isBowling ? " · Bowling Machine" : ""}
                  </p>

                  <div className="mt-4">
                    <span className="text-sm text-zinc-500 line-through">
                      {inr(plan.baseAmount)}
                    </span>
                    <span className="ml-2 text-2xl font-bold text-white">
                      {inr(plan.price)}
                    </span>
                    <span className="ml-2 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                      Save {plan.discountPercent}%
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-emerald-300">
                    {inr(plan.effectiveHourly)}/hr instead of{" "}
                    {inr(plan.anchorPricePerHour)}/hr
                  </p>

                  <div className="mt-3 flex items-center gap-4 text-xs text-zinc-400">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" /> {plan.hours} hours
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck className="h-3.5 w-3.5" /> Valid{" "}
                      {plan.validityDays} days
                    </span>
                  </div>

                  <button
                    onClick={() => buy(plan)}
                    disabled={buying === plan.id}
                    className="mt-4 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
                  >
                    {buying === plan.id ? "Opening payment…" : "Buy pass"}
                  </button>
                </div>
              ))}
            </div>
          )}
          {error && <p className="mt-3 text-sm text-amber-300">{error}</p>}
        </section>

        {/* How it works */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-white">How it works</h2>
          <ol className="grid gap-3 sm:grid-cols-3">
            {[
              ["1. Buy a pass", "Pick a pass for your sport and pay online — hours land on your account instantly."],
              ["2. Book as usual", "Choose your date and slots exactly like a normal booking."],
              ["3. Pay with hours", "At checkout, choose “Use my pass” — hours are deducted instead of money. If the booking is longer than your balance, pay just the difference."],
            ].map(([t, d]) => (
              <li key={t} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                <p className="font-medium text-white">{t}</p>
                <p className="mt-1 text-sm text-zinc-400">{d}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Terms */}
        <section className="pb-10">
          <button
            onClick={() => setTermsOpen((o) => !o)}
            className="flex w-full items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-left"
          >
            <span className="font-medium text-white">
              Terms, conditions & policies
            </span>
            <ChevronDown
              className={`h-4 w-4 text-zinc-400 transition-transform ${termsOpen ? "rotate-180" : ""}`}
            />
          </button>
          {termsOpen && (
            <ul className="mt-2 space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 text-sm text-zinc-400">
              {TERMS.map((t) => (
                <li key={t} className="flex gap-2">
                  <span className="text-emerald-500">•</span> {t}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
