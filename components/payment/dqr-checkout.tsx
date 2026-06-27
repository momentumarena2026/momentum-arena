"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  ScanLine,
} from "lucide-react";
import { formatPrice } from "@/lib/pricing";

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
 * Dynamic-QR checkout (SCAN flow). Generates a PhonePe DQR for this
 * hold/intent, renders it as a QR the customer scans with ANY UPI app, and
 * polls the status endpoint until PhonePe confirms — at which point the
 * booking/order is auto-created server-side. No "I've paid" trust step and
 * no manual UTR/screenshot-to-us: confirmation is gateway-driven.
 *
 * Why scan-only (no tap-to-pay link): UPI blocks tappable intent/link
 * payments for our merchant VPA, so the customer must scan. On the same
 * phone they screenshot/save the QR and use their UPI app's "scan from
 * gallery"; on desktop they scan with their phone.
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
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const txnRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef(false);

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
      const res = await fetch(
        `${statusBase}?transactionId=${encodeURIComponent(txn)}`,
      );
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
      if (!res.ok || !data.qrImage) {
        setError(data.error || "Couldn't start UPI payment");
        setPhase("error");
        return;
      }
      txnRef.current = data.transactionId;
      setQrDataUrl(data.qrImage);
      setSecondsLeft(typeof data.expiresIn === "number" ? data.expiresIn : null);
      setPhase("scan");
    } catch {
      setError("Couldn't start UPI payment");
      setPhase("error");
    }
  }, [initiateUrl, surface, holdId, isAdvance, overrideAmount]);

  // Kick off on mount. `initiate` only setStates AFTER its network await.
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

  // QR expiry countdown — PhonePe rejects an expired QR. When the TTL runs
  // out, stop polling and prompt a regenerate (the error retry re-initiates).
  useEffect(() => {
    if (phase !== "scan" || secondsLeft == null) return;
    if (secondsLeft <= 0) {
      doneRef.current = true;
      stopPolling();
      setError("This QR has expired. Generate a new one to continue.");
      setPhase("error");
      return;
    }
    const id = setTimeout(
      () => setSecondsLeft((s) => (s == null ? s : s - 1)),
      1000,
    );
    return () => clearTimeout(id);
  }, [phase, secondsLeft, stopPolling]);

  if (phase === "confirmed") {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8 text-center">
        <CheckCircle2 className="h-14 w-14 text-emerald-400" />
        <h3 className="mt-3 text-xl font-bold text-white">Payment Confirmed!</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Taking you to your confirmation…
        </p>
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
    <div className="space-y-5">
      {/* QR + amount + auto-confirm status. Plain <img> on a ready data URL
          so it decodes immediately — iOS Safari skips next/image lazy-load. */}
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
        <p className="mt-3 flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for payment…
        </p>
        {secondsLeft != null && (
          <p className="mt-1 text-xs text-zinc-500">
            Expires in {Math.floor(secondsLeft / 60)}:
            {String(secondsLeft % 60).padStart(2, "0")}
          </p>
        )}
        <p className="mt-1 text-xs text-zinc-600">
          Confirms automatically the moment you pay — nothing to send us.
        </p>
      </div>

      {/* How to pay — scan instructions (replaces the old tap-to-pay app
          chooser, which UPI blocks for this merchant). */}
      <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3.5">
        <p className="flex items-center gap-2 text-sm font-medium text-white">
          <ScanLine className="h-4 w-4 text-emerald-400" />
          Scan &amp; pay with any UPI app
        </p>
        <p className="text-xs text-zinc-400">
          Open GPay, PhonePe, Paytm, BHIM — or any UPI app — and scan the QR
          above.
        </p>
        <div className="space-y-2 border-t border-zinc-800 pt-3">
          <p className="text-xs font-medium text-zinc-300">
            Paying on this phone?
          </p>
          <p className="text-xs text-zinc-400">
            Save the QR, then in your UPI app tap{" "}
            <span className="text-zinc-200">Scan</span> →{" "}
            <span className="text-zinc-200">Gallery / Upload</span> and pick it.
          </p>
          {qrDataUrl && (
            <a
              href={qrDataUrl}
              download="momentum-arena-upi-qr.png"
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
            >
              <Download className="h-3.5 w-3.5" /> Save QR
            </a>
          )}
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <p className="text-xs leading-relaxed text-amber-200/90">
          <span className="font-semibold text-amber-300">
            Pay from your bank-linked UPI
          </span>{" "}
          (savings/current). Wallet balance, credit-card-on-UPI and overdraft
          accounts aren&apos;t accepted and will fail.
        </p>
      </div>

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
