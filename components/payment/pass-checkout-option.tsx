"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ticket } from "lucide-react";
import { formatPrice } from "@/lib/pricing";
import { trackPassRedeemed } from "@/lib/analytics";

export interface PassCheckoutOffer {
  passName: string;
  remainingMinutes: number;
  neededMinutes: number;
  coveredMinutes: number;
  fullCoverage: boolean;
  remainderAmount: number;
  /** Per-pass breakdown when the booking draws on several passes. */
  passes?: {
    passId: string;
    passName: string;
    coveredMinutes: number;
    remainingMinutes?: number;
  }[];
}

function loadRzp(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

/**
 * "Use my pass" banner on the booking checkout. Full coverage books
 * instantly (₹0); partial coverage debits the pass and collects the
 * pro-rata remainder via Razorpay. Rendered above the regular payment
 * selector; passes don't combine with coupons/points (server-enforced).
 */
export function PassCheckoutOption({
  holdId,
  offer,
}: {
  holdId: string;
  offer: PassCheckoutOffer;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hrs = (m: number) => `${(m / 60).toFixed(1).replace(/\.0$/, "")}h`;

  async function redeem() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/passes/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't redeem the pass");

      if (data.bookingId) {
        trackPassRedeemed(offer.coveredMinutes, 0);
        router.push(`/book/confirmation/${data.bookingId}`);
        return;
      }
      // Top-up path — collect the remainder.
      if (!(await loadRzp())) throw new Error("Couldn't load the payment window");
      const t = data.topup;
      const rzp = new window.Razorpay({
        key: t.keyId,
        amount: Math.round(t.amount * 100),
        currency: "INR",
        name: "Momentum Arena",
        description: "Pass top-up — balance difference",
        order_id: t.orderId,
        theme: { color: "#10b981" },
        handler: async (resp: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          const v = await fetch("/api/passes/redeem-verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              holdId,
              razorpayOrderId: resp.razorpay_order_id,
              razorpayPaymentId: resp.razorpay_payment_id,
              razorpaySignature: resp.razorpay_signature,
            }),
          });
          const vd = await v.json();
          if (v.ok && vd.bookingId) {
            trackPassRedeemed(offer.coveredMinutes, offer.remainderAmount);
            router.push(`/book/confirmation/${vd.bookingId}`);
          } else setError(vd.error || "Payment received — confirming your booking…");
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.open();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  const shares = offer.passes ?? [];
  const multi = shares.length > 1;
  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
      <div className="flex items-center gap-2">
        <Ticket className="h-4 w-4 text-emerald-400" />
        <p className="text-sm font-semibold text-white">
          {multi ? `${shares.length} passes` : offer.passName}
        </p>
        {!multi && (
          <span className="ml-auto text-xs text-zinc-400">
            {hrs(offer.remainingMinutes)} left
          </span>
        )}
      </div>
      {multi && (
        <div className="mt-2 space-y-1">
          {shares.map((share) => (
            <div
              key={share.passId}
              className="flex justify-between text-xs text-zinc-300"
            >
              <span>{share.passName}</span>
              <span className="text-emerald-400">
                {hrs(share.coveredMinutes)}
                {typeof share.remainingMinutes === "number"
                  ? ` · ${hrs(share.remainingMinutes)} left`
                  : ""}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-1 text-xs text-zinc-400">
        {offer.fullCoverage
          ? `This booking (${hrs(offer.neededMinutes)}) is fully covered by your ${multi ? "passes" : "pass"} — nothing to pay.`
          : offer.coveredMinutes >= offer.neededMinutes
          ? // All the court time is covered; the remainder is equipment,
            // which a pass never pays for.
            `Your ${multi ? "passes cover" : "pass covers"} the full ${hrs(offer.neededMinutes)} of court time; pay ${formatPrice(offer.remainderAmount)} for the equipment.`
          : `Your ${multi ? "passes cover" : "pass covers"} ${hrs(offer.coveredMinutes)} of ${hrs(offer.neededMinutes)}; pay ${formatPrice(offer.remainderAmount)} for the rest.`}
      </p>
      <button
        onClick={redeem}
        disabled={busy}
        className="mt-3 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
      >
        {busy
          ? "Processing…"
          : offer.fullCoverage
          ? multi
            ? "Book with my passes"
            : "Book with my pass"
          : `Use pass + pay ${formatPrice(offer.remainderAmount)}`}
      </button>
      {error && <p className="mt-2 text-xs text-amber-300">{error}</p>}
      <p className="mt-2 text-[11px] text-zinc-500">
        Passes can&apos;t be combined with coupons or points.
      </p>
    </div>
  );
}
