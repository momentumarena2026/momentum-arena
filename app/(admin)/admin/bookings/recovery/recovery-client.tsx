"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  Search,
} from "lucide-react";
import {
  recoverRazorpayPayment,
  type RecoverRazorpayResult,
} from "@/actions/admin-booking";

/**
 * Client UI for the Razorpay payment recovery tool. Two phases:
 *  1. Form with a single `paymentId` input (Razorpay `pay_…`)
 *  2. Result card — green when a booking was created or already
 *     linked, amber when no SlotHold matches (admin needs the
 *     manual "+ New Booking" fallback), red on errors.
 */
export function RecoveryClient() {
  const [paymentId, setPaymentId] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<RecoverRazorpayResult | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setResult(null);
    try {
      const r = await recoverRazorpayPayment(paymentId);
      setResult(r);
    } catch (err) {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={onSubmit}
        className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-3"
      >
        <label className="block text-xs font-medium uppercase tracking-wider text-zinc-500">
          Razorpay payment ID
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <input
              type="text"
              value={paymentId}
              onChange={(e) => setPaymentId(e.target.value)}
              placeholder="pay_XYZabc123"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 pl-9 pr-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <button
            type="submit"
            disabled={pending || !paymentId.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Looking up…
              </>
            ) : (
              "Recover"
            )}
          </button>
        </div>
        <p className="text-[11px] text-zinc-600">
          Paste the <code className="text-emerald-400">pay_…</code> id exactly
          as it appears on the Razorpay dashboard. We verify it via Razorpay&apos;s
          API before touching the DB.
        </p>
      </form>

      {result && <ResultCard result={result} />}
    </div>
  );
}

function ResultCard({ result }: { result: RecoverRazorpayResult }) {
  // 1. Hard error (Razorpay 4xx, validation, etc.)
  if (!result.success) {
    return (
      <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-5 space-y-2">
        <div className="flex items-center gap-2 text-red-300 font-semibold">
          <AlertCircle className="h-5 w-5" />
          Recovery failed
        </div>
        <p className="text-sm text-red-200/80">{result.error}</p>
        {result.payment && <PaymentMetadata p={result.payment} />}
      </div>
    );
  }

  // 2. Booking created or already existed — green path
  if (result.state === "created" || result.state === "already-linked") {
    const headline =
      result.state === "created"
        ? "Booking created from captured payment"
        : "Booking already linked to this payment";
    return (
      <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-5 space-y-3">
        <div className="flex items-center gap-2 text-emerald-300 font-semibold">
          <CheckCircle2 className="h-5 w-5" />
          {headline}
        </div>
        {result.bookingId && (
          <Link
            href={`/admin/bookings/${result.bookingId}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/15"
          >
            View booking
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        )}
        {result.payment && <PaymentMetadata p={result.payment} />}
      </div>
    );
  }

  // 3. No matching SlotHold — admin needs the manual fallback
  if (result.state === "no-hold" && result.payment) {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 space-y-3">
        <div className="flex items-center gap-2 text-amber-300 font-semibold">
          <AlertCircle className="h-5 w-5" />
          No matching slot hold
        </div>
        <p className="text-sm text-amber-100/80">
          Payment is captured in Razorpay, but no SlotHold matches{" "}
          <code className="text-amber-200">{result.payment.orderId}</code> —
          likely the hold was already swept by the 3am cleanup cron. Use the
          regular &quot;+ New Booking&quot; flow to create the booking, then
          mark it paid with the Razorpay reference below.
        </p>
        <Link
          href="/admin/bookings/create"
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/15"
        >
          + New booking (manual)
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
        <PaymentMetadata p={result.payment} />
      </div>
    );
  }

  return null;
}

function PaymentMetadata({
  p,
}: {
  p: NonNullable<RecoverRazorpayResult["payment"]>;
}) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs">
      <dt className="text-zinc-500">Payment ID</dt>
      <dd className="font-mono text-zinc-200">{p.id}</dd>
      <dt className="text-zinc-500">Order ID</dt>
      <dd className="font-mono text-zinc-200">{p.orderId}</dd>
      <dt className="text-zinc-500">Amount</dt>
      <dd className="text-zinc-200">
        ₹{p.amountRupees.toLocaleString("en-IN")}
      </dd>
      <dt className="text-zinc-500">Status</dt>
      <dd className="text-zinc-200">
        {p.status}
        {p.captured ? " · captured" : ""}
      </dd>
      {p.contact && (
        <>
          <dt className="text-zinc-500">Contact</dt>
          <dd className="text-zinc-200">{p.contact}</dd>
        </>
      )}
      {p.email && (
        <>
          <dt className="text-zinc-500">Email</dt>
          <dd className="text-zinc-200">{p.email}</dd>
        </>
      )}
      <dt className="text-zinc-500">Captured at</dt>
      <dd className="text-zinc-200">
        {new Date(p.createdAt * 1000).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })}
      </dd>
    </dl>
  );
}
