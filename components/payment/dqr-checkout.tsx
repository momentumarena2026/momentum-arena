"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import { formatPrice } from "@/lib/pricing";

/**
 * Square brand tile for an iOS UPI-app button. Real logo assets aren't
 * bundled, so these are brand-coloured marks (drop a logo PNG into
 * /public and swap the inner mark if pixel-perfect logos are wanted).
 */
function UpiAppGlyph({ id }: { id: string }) {
  if (id === "gpay") {
    return (
      <span className="flex aspect-square w-full items-center justify-center rounded-2xl border border-zinc-300 bg-white">
        <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
          <circle cx="7" cy="7" r="3.2" fill="#4285F4" />
          <circle cx="17" cy="7" r="3.2" fill="#EA4335" />
          <circle cx="7" cy="17" r="3.2" fill="#FBBC05" />
          <circle cx="17" cy="17" r="3.2" fill="#34A853" />
        </svg>
      </span>
    );
  }
  if (id === "phonepe") {
    return (
      <span className="flex aspect-square w-full items-center justify-center rounded-2xl bg-[#5f259f] text-lg font-bold text-white">
        Pe
      </span>
    );
  }
  if (id === "paytm") {
    return (
      <span className="flex aspect-square w-full items-center justify-center rounded-2xl bg-[#00b9f1] text-lg font-bold text-white">
        P
      </span>
    );
  }
  return (
    <span className="flex aspect-square w-full items-center justify-center rounded-2xl border border-zinc-700 bg-zinc-800">
      <Smartphone className="h-6 w-6 text-emerald-400" />
    </span>
  );
}

interface DqrCheckoutProps {
  holdId: string;
  amount: number;
  /** Full net payable (post coupon + points) sent to the booking initiate
   *  route as `overrideAmount`; the route halves it for the advance flow.
   *  Without this the route falls back to the gross hold total and the
   *  customer's discount/points are silently dropped. Booking surface only. */
  overrideAmount?: number;
  isAdvance?: boolean;
  advanceAmount?: number;
  remainingAmount?: number;
  /** "booking" hits /api/phonepe/dqr/*, "cafe" hits the cafe-* variants. */
  surface?: "booking" | "cafe";
  /** For cafe: the CafePaymentIntent id passed as `holdId`-equivalent. */
  onConfirmed: (id: string) => void;
  onCancel?: () => void;
}

type Phase = "init" | "scan" | "confirmed" | "error";

const POLL_MS = 3000;

/**
 * Dynamic-QR checkout. Generates a PhonePe DQR for this hold/intent,
 * renders the returned `qrString` as a QR (+ a same-device deep link),
 * and polls the status endpoint until PhonePe confirms — at which point
 * the booking/order is auto-created server-side. No "I've paid" trust
 * step: confirmation is driven by the gateway, like the redirect flow.
 */
export function DqrCheckout({
  holdId,
  amount,
  overrideAmount,
  isAdvance,
  advanceAmount,
  remainingAmount,
  surface = "booking",
  onConfirmed,
  onCancel,
}: DqrCheckoutProps) {
  const [phase, setPhase] = useState<Phase>("init");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrString, setQrString] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const txnRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef(false);

  // On a phone, scanning a QR shown on that same phone is impossible, so we
  // lead with a tap-to-pay deep link (opens the UPI app with payee + amount
  // prefilled) and demote the QR to a "scan from another device" disclosure.
  // Desktop has no UPI app, so it keeps the QR as the primary path.
  // Set after mount (not in useState init) to avoid an SSR hydration
  // mismatch — the server can't know the device, so it always renders the
  // desktop layout first, then this flips it on the client.
  const [isMobile, setIsMobile] = useState(false);
  // iOS has no UPI intent chooser: a `upi://` link opens whichever app
  // claims the scheme (often WhatsApp), so on iOS we render explicit
  // per-app buttons built from the same UPI params. Android's `upi://`
  // shows a proper chooser, so it keeps the single button.
  const [isIos, setIsIos] = useState(false);
  useEffect(() => {
    if (typeof navigator !== "undefined") {
      const ua = navigator.userAgent;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsMobile(/Android|iPhone|iPad|iPod|Mobile/i.test(ua));
      setIsIos(/iPhone|iPad|iPod/i.test(ua));
    }
  }, []);

  // Same UPI params, re-prefixed per app. The qrString is
  // `upi://pay?pa=…&am=…`; everything after `?` is reused verbatim.
  const upiParams =
    qrString && qrString.includes("?")
      ? qrString.slice(qrString.indexOf("?") + 1)
      : "";
  const upiApps = [
    { id: "gpay", label: "GPay", href: `tez://upi/pay?${upiParams}` },
    { id: "phonepe", label: "PhonePe", href: `phonepe://pay?${upiParams}` },
    { id: "paytm", label: "Paytm", href: `paytmmp://pay?${upiParams}` },
    { id: "other", label: "UPI", href: `upi://pay?${upiParams}` },
  ];

  const displayAmount = isAdvance && advanceAmount ? advanceAmount : amount;
  const initiateUrl =
    surface === "cafe"
      ? "/api/phonepe/dqr/cafe-initiate"
      : "/api/phonepe/dqr/initiate";
  const statusBase =
    surface === "cafe"
      ? "/api/phonepe/dqr/cafe-status"
      : "/api/phonepe/dqr/status";

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const checkStatus = useCallback(async () => {
    const txn = txnRef.current;
    if (!txn || doneRef.current) return;
    try {
      const res = await fetch(`${statusBase}?transactionId=${encodeURIComponent(txn)}`);
      const data = await res.json();
      const settledId = surface === "cafe" ? data.orderId : data.bookingId;
      if (data.state === "COMPLETED" && settledId) {
        doneRef.current = true;
        stopPolling();
        setPhase("confirmed");
        onConfirmed(settledId);
      } else if (data.state === "FAILED") {
        doneRef.current = true;
        stopPolling();
        setError("Payment failed or expired. Please try again.");
        setPhase("error");
      }
    } catch {
      // Transient — keep polling; the S2S callback is the backstop.
    }
  }, [statusBase, surface, onConfirmed, stopPolling]);

  const initiate = useCallback(async () => {
    // No synchronous setState here — this runs from the mount effect.
    // Phase/error resets for the retry path happen in the button handler.
    doneRef.current = false;
    try {
      const res = await fetch(initiateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          surface === "cafe"
            ? { orderId: holdId }
            : { holdId, isAdvance: !!isAdvance, overrideAmount },
        ),
      });
      const data = await res.json();
      if (!res.ok || !data.qrString) {
        setError(data.error || "Couldn't start UPI payment");
        setPhase("error");
        return;
      }
      txnRef.current = data.transactionId;
      setQrString(data.qrString);
      setQrDataUrl(data.qrImage);
      setPhase("scan");
    } catch {
      setError("Couldn't start UPI payment");
      setPhase("error");
    }
  }, [initiateUrl, surface, holdId, isAdvance, overrideAmount]);

  // Kick off on mount. `initiate` only setStates AFTER its network
  // await (and from event handlers), so this is a genuine data-fetch
  // effect, not a synchronous cascading render — the rule's heuristic
  // can't see past the await, so disable it for this one call.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    initiate();
    return stopPolling;
  }, [initiate, stopPolling]);

  // Start polling once the QR is showing.
  useEffect(() => {
    if (phase !== "scan") return;
    pollRef.current = setInterval(checkStatus, POLL_MS);
    return stopPolling;
  }, [phase, checkStatus, stopPolling]);

  if (phase === "confirmed") {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8 text-center">
        <CheckCircle2 className="h-14 w-14 text-emerald-400" />
        <h3 className="mt-3 text-xl font-bold text-white">Payment Confirmed!</h3>
        <p className="mt-1 text-sm text-zinc-400">Taking you to your confirmation…</p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-red-400" />
          <p className="mt-3 text-sm text-red-300">{error}</p>
        </div>
        <button
          onClick={() => {
            setPhase("init");
            setError(null);
            initiate();
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white hover:bg-emerald-700"
        >
          <RefreshCw className="h-4 w-4" /> Try again
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="w-full py-2 text-sm text-zinc-500 hover:text-zinc-300"
          >
            ← Go back
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`space-y-5 ${isIos ? "pb-44" : ""}`}>
      {/* QR is ALWAYS shown at the top (matches desktop), then the amount
          and the auto-confirm status. Plain <img> on a ready data URL so it
          decodes immediately — iOS Safari skips next/image's lazy-load. */}
      <div className="flex flex-col items-center rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        {qrDataUrl ? (
          <div className="rounded-xl bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt="UPI QR — scan to pay"
              width={240}
              height={240}
              className="rounded-lg"
            />
          </div>
        ) : (
          <div className="flex h-[240px] w-[240px] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
          </div>
        )}

        <p className="mt-5 text-3xl font-bold text-emerald-400">
          Pay {formatPrice(displayAmount)}
        </p>
        {isAdvance && advanceAmount != null && (
          <p className="mt-1 text-xs text-yellow-400">
            Advance: {formatPrice(advanceAmount)} · Remaining at venue:{" "}
            {formatPrice(remainingAmount ?? Math.max(0, amount - advanceAmount))}
          </p>
        )}
        <p className="mt-2 flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for payment…
        </p>
        <p className="mt-1 text-xs text-zinc-600">
          Confirms automatically once you pay — no screenshot needed.
        </p>
      </div>

      {/* Android: a single button resolves upi:// to the system chooser. */}
      {isMobile && !isIos && qrString && (
        <div className="space-y-2">
          <a
            href={qrString}
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-emerald-600 px-4 py-4 text-lg font-bold text-white hover:bg-emerald-500 active:bg-emerald-700"
          >
            <Smartphone className="h-5 w-5" />
            <span>Pay {formatPrice(displayAmount)} via UPI</span>
          </a>
          <p className="text-center text-xs text-zinc-500">
            Opens PhonePe, Google Pay, Paytm, BHIM…
          </p>
        </div>
      )}

      <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <p className="text-xs leading-relaxed text-amber-200/90">
          <span className="font-semibold text-amber-300">Pay from your bank-linked UPI</span>{" "}
          (savings/current). Wallet balance, credit-card-on-UPI and overdraft
          accounts aren&apos;t accepted and will fail.
        </p>
      </div>

      {/* Desktop: no UPI app to deep-link into — instruct to scan. */}
      {!isMobile && (
        <p className="text-center text-xs text-zinc-500">
          Scan the QR with any UPI app to pay
        </p>
      )}

      {onCancel && (
        <button
          onClick={onCancel}
          className="w-full py-2 text-sm text-zinc-500 hover:text-zinc-300"
        >
          ← Go back
        </button>
      )}

      {/* iOS: sticky bottom bar of square app-icon buttons. iOS has no UPI
          chooser, so each app gets its own scheme-specific deep link. */}
      {isMobile && isIos && qrString && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800 bg-zinc-950/95 px-4 pb-6 pt-3 backdrop-blur">
          <p className="mb-2.5 text-center text-xs font-medium text-zinc-300">
            Pay {formatPrice(displayAmount)} — choose your UPI app
          </p>
          <div className="mx-auto flex w-full max-w-md gap-3">
            {upiApps.map((app) => (
              <a
                key={app.id}
                href={app.href}
                className="flex flex-1 flex-col items-center gap-1.5 active:opacity-80"
              >
                <UpiAppGlyph id={app.id} />
                <span className="text-[11px] text-zinc-400">{app.label}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
