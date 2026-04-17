"use client";

import { useState, useMemo } from "react";
import { CheckCircle2, CircleCheck, ShieldCheck, Loader2 } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import Image from "next/image";
import { formatPrice } from "@/lib/pricing";
import { trackUpiQrShown, trackUpiPaymentConfirmed, trackUpiWhatsappClick } from "@/lib/analytics";

export type UpiCommitResult = { bookingId?: string; error?: string } | void;

interface UpiQrCheckoutProps {
  amount: number;
  bookingId?: string;
  /**
   * Called when the user clicks "I've completed the payment". Should commit
   * the booking server-side and return the created bookingId (or an error).
   * The component stays on the QR step if an error is returned, and only
   * advances to the "paid" WhatsApp-share step on success.
   */
  onPaymentInitiated?: () => Promise<UpiCommitResult> | UpiCommitResult;
  onCancel?: () => void;
  isAdvance?: boolean;
  advanceAmount?: number;
  qrType?: "turf" | "cafe";
}

const TURF_QR_OPTIONS = [
  { image: "/phonepe-qr-1.png", label: "Terminal 1" },
  { image: "/phonepe-qr-2.png", label: "Terminal 2" },
  { image: "/phonepe-qr-3.png", label: "Terminal 3" },
];

const CAFE_QR_OPTIONS = [
  { image: "/phonepe-cafe-qr-1.jpg", label: "Cafe Terminal 1" },
  { image: "/phonepe-cafe-qr-2.jpg", label: "Cafe Terminal 2" },
  { image: "/phonepe-cafe-qr-3.jpg", label: "Cafe Terminal 3" },
];

const WHATSAPP_NUMBER = "916396177261";

type Step = "scan" | "paid";

export function UpiQrCheckout({
  amount,
  bookingId,
  onPaymentInitiated,
  onCancel,
  isAdvance,
  advanceAmount,
  qrType = "turf",
}: UpiQrCheckoutProps) {
  const [step, setStep] = useState<Step>("scan");
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [committedBookingId, setCommittedBookingId] = useState<string | undefined>(
    // If a real Booking id was passed in (e.g. legacy callers), surface it in
    // WhatsApp messages; otherwise wait for onPaymentInitiated to return one.
    bookingId
  );

  // Pick a random QR on mount (stable across re-renders)
  const selectedQr = useMemo(() => {
    const options = qrType === "cafe" ? CAFE_QR_OPTIONS : TURF_QR_OPTIONS;
    return options[Math.floor(Math.random() * options.length)];
  }, [qrType]);

  const displayAmount = isAdvance && advanceAmount ? advanceAmount : amount;

  // WhatsApp URL — uses the real bookingId once the booking has been committed.
  const whatsappMessage = encodeURIComponent(
    committedBookingId
      ? `Hi, I've made a payment of ${formatPrice(displayAmount)} for Booking #${committedBookingId.slice(-8)}.\n\nPlease find the payment screenshot attached. Kindly confirm my booking.`
      : `Hi, I've made a payment of ${formatPrice(displayAmount)}.\n\nPlease find the payment screenshot attached. Kindly confirm my booking.`
  );
  const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${whatsappMessage}`;

  // Track QR shown on mount
  useState(() => { trackUpiQrShown(displayAmount); });

  const handlePaymentDone = async () => {
    if (committing) return;
    setCommitting(true);
    setCommitError(null);
    try {
      const result = await onPaymentInitiated?.();
      if (result && result.error) {
        setCommitError(result.error);
        return; // stay on scan step so user can retry or go back
      }
      if (result && result.bookingId) {
        setCommittedBookingId(result.bookingId);
      }
      trackUpiPaymentConfirmed(displayAmount);
      setStep("paid");
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setCommitting(false);
    }
  };

  // ---------- Step 2: Payment done → slot reserved confirmation ----------
  if (step === "paid") {
    return (
      <div className="space-y-5">
        {/* Slot reserved confirmation */}
        <div className="flex flex-col items-center rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8 text-center space-y-4">
          <CheckCircle2 className="h-14 w-14 text-emerald-400" />
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-white">
              Your Slot is Reserved!
            </h3>
            <p className="text-sm text-zinc-400 max-w-xs">
              Please allow us 30 minutes to verify your payment and confirm your booking.
            </p>
          </div>
        </div>

        {/* Screenshot reminder */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-white">
                Send Payment Screenshot
              </p>
              <p className="text-sm text-zinc-400">
                Please share a screenshot of your payment on WhatsApp so our team can verify and confirm your booking quickly.
              </p>
            </div>
          </div>

          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackUpiWhatsappClick(committedBookingId)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-3.5 font-semibold text-white transition-colors hover:bg-green-700"
          >
            <FaWhatsapp className="h-5 w-5" />
            Share Screenshot on WhatsApp
          </a>

          <a
            href={
              committedBookingId
                ? `/book/confirmation?id=${committedBookingId}`
                : "/bookings"
            }
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3.5 font-semibold text-white transition-colors hover:bg-zinc-700"
          >
            {committedBookingId ? "View Booking Details" : "My Bookings"}
          </a>
        </div>

        <p className="text-center text-xs text-zinc-500">
          You&apos;ll receive a confirmation message once verified.
        </p>
      </div>
    );
  }

  // ---------- Step 1: Scan QR and pay ----------
  return (
    <div className="space-y-5">
      {/* QR Code */}
      <div className="flex flex-col items-center rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="rounded-xl bg-white p-3">
          <Image
            src={selectedQr.image}
            alt="PhonePe QR Code - Scan to Pay"
            width={280}
            height={280}
            className="rounded-lg"
            priority
          />
        </div>

        <p className="mt-5 text-3xl font-bold text-emerald-400">
          Pay {formatPrice(displayAmount)}
        </p>

        {isAdvance && advanceAmount && (
          <p className="mt-1 text-xs text-yellow-400">
            Advance payment &middot; Remaining at venue: {formatPrice(amount - advanceAmount)}
          </p>
        )}

        <p className="mt-2 text-sm text-zinc-400">
          Scan &amp; pay using any UPI app
        </p>
        <p className="mt-1 text-xs text-zinc-600">
          Sportive Ventures &middot; {selectedQr.label}
        </p>
      </div>

      {commitError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-center text-sm text-red-400">
          {commitError}
        </div>
      )}

      {/* Mark Payment Done button */}
      <button
        onClick={handlePaymentDone}
        disabled={committing}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-emerald-500/30 bg-emerald-500/10 px-4 py-3.5 font-semibold text-emerald-400 transition-all hover:bg-emerald-500/20 hover:border-emerald-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {committing ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Reserving your slot...
          </>
        ) : (
          <>
            <CircleCheck className="h-5 w-5" />
            I&apos;ve Completed the Payment
          </>
        )}
      </button>

      <p className="text-center text-xs text-zinc-600">
        Click above after you&apos;ve successfully paid via UPI
      </p>

      {onCancel && (
        <button
          onClick={onCancel}
          disabled={committing}
          className="w-full text-center text-sm text-zinc-500 hover:text-zinc-300 transition-colors py-2 disabled:opacity-50"
        >
          ← Go back
        </button>
      )}
    </div>
  );
}
