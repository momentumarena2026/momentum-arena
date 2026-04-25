"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleCheck,
  ShieldCheck,
  Loader2,
  Smartphone,
} from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import Image from "next/image";
import { formatPrice } from "@/lib/pricing";
import {
  trackUpiQrShown,
  trackUpiPaymentConfirmed,
  trackUpiWhatsappClick,
  trackUpiAppLaunched,
} from "@/lib/analytics";

// Payee name shown by the UPI app on the confirmation screen. Matches
// the merchant name decoded from the QR PNGs and the existing UI
// subtitle ("Sportive Ventures").
const PAYEE_NAME = "Sportive Ventures";

/**
 * Crude UA sniff to decide whether the browser is on a phone/tablet.
 * `upi://pay?…` does nothing on desktop browsers (no UPI app to open),
 * so we hide the button there to avoid a confusing dead click. We only
 * run it client-side — SSR returns `false` so the markup matches the
 * pre-hydration tree.
 */
function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

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

// Each terminal is paired with the VPA encoded inside its PhonePe QR
// PNG — that way the same-device deep link routes the payment to the
// same terminal account that would receive a scanned payment, and we
// don't need any server-side config for the button to work. (The VPAs
// are already public information: they're inside every QR we ship.)
const TURF_QR_OPTIONS = [
  { image: "/phonepe-qr-1.png", label: "Terminal 1", vpa: "Q611766519@ybl" },
  { image: "/phonepe-qr-2.png", label: "Terminal 2", vpa: "Q991517867@ybl" },
  { image: "/phonepe-qr-3.png", label: "Terminal 3", vpa: "Q510049074@ybl" },
];

const CAFE_QR_OPTIONS = [
  { image: "/phonepe-cafe-qr-1.jpg", label: "Cafe Terminal 1", vpa: "Q006205199@ybl" },
  { image: "/phonepe-cafe-qr-2.jpg", label: "Cafe Terminal 2", vpa: "Q410883008@ybl" },
  { image: "/phonepe-cafe-qr-3.jpg", label: "Cafe Terminal 3", vpa: "Q795500531@ybl" },
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

  // Resolve the UA sniff after mount so the SSR markup (`isMobile=false`)
  // and the hydrated client agree on first paint, then update.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    setIsMobile(isMobileBrowser());
  }, []);

  /**
   * UPI Spec deep link — `upi://pay?pa=…&pn=…&am=…&cu=INR&tn=…`. On a
   * mobile browser, clicking the link makes the OS hand control to an
   * installed UPI app (PhonePe / GPay / Paytm / BHIM / CRED…) with the
   * VPA, payee name, and amount already filled in. On desktop the
   * scheme has no handler, so we hide the button there.
   *
   * Uses the VPA paired with the displayed terminal QR (see
   * TURF_QR_OPTIONS / CAFE_QR_OPTIONS) so the deep link routes payment
   * to the same terminal account a scan would.
   */
  const upiDeepLink = useMemo(() => {
    const params = new URLSearchParams({
      pa: selectedQr.vpa,
      pn: PAYEE_NAME,
      am: displayAmount.toFixed(2),
      cu: "INR",
      tn: committedBookingId
        ? `Momentum Arena Booking #${committedBookingId.slice(-8)}`
        : "Momentum Arena Booking",
    });
    return `upi://pay?${params.toString()}`;
  }, [committedBookingId, displayAmount, selectedQr]);

  const showUpiAppButton = isMobile;

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
      {/* Same-device payment CTA — opens an installed UPI app via the
          `upi://pay?…` deep link. Only rendered on mobile browsers
          (UA-sniffed) since desktop browsers have no handler for the
          `upi://` scheme. */}
      {showUpiAppButton ? (
        <>
          <a
            href={upiDeepLink}
            onClick={() => trackUpiAppLaunched(displayAmount)}
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-emerald-600 px-4 py-3.5 font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500 active:bg-emerald-700"
          >
            <Smartphone className="h-5 w-5" />
            <div className="flex flex-col items-start leading-tight">
              <span className="text-base">Pay with UPI App</span>
              <span className="text-[11px] font-normal text-emerald-50/85">
                Opens PhonePe, GPay, Paytm, BHIM…
              </span>
            </div>
          </a>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-zinc-800" />
            <span className="text-[10px] font-semibold tracking-[0.12em] text-zinc-500">
              OR SCAN WITH ANOTHER DEVICE
            </span>
            <div className="h-px flex-1 bg-zinc-800" />
          </div>
        </>
      ) : null}

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
