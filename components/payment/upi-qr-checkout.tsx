"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { AlertCircle, CircleCheck, Loader2, Smartphone, X } from "lucide-react";
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
  /** Venue balance after the advance UPI payment (50% now flow). */
  remainingAmount?: number;
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

// Same chrome as the DQR sheet (components/payment/dqr-checkout.tsx):
// slide-up on mobile, pop-in on sm+, plus the success check-draw pair.
// Keyframe names are `upiqr-` prefixed so both components can coexist
// without redeclaring each other's animations.
const SHEET_KEYFRAMES = `
@keyframes upiqr-fade-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes upiqr-sheet-up { from { transform: translateY(100%) } to { transform: translateY(0) } }
@keyframes upiqr-sheet-pop { from { opacity: 0; transform: translateY(8px) scale(0.97) } to { opacity: 1; transform: translateY(0) scale(1) } }
@keyframes upiqr-check-pop { 0% { transform: scale(0) } 70% { transform: scale(1.08) } 100% { transform: scale(1) } }
@keyframes upiqr-check-draw { to { stroke-dashoffset: 0 } }
.upiqr-sheet { animation: upiqr-sheet-up 250ms ease-out; }
@media (min-width: 640px) { .upiqr-sheet { animation: upiqr-sheet-pop 200ms ease-out; } }
`;

/**
 * LEGACY static-QR UPI checkout, rendered as the same Razorpay-style dark
 * bottom sheet as the DQR flow (components/payment/dqr-checkout.tsx) so
 * every UPI payment shares one consistent UI. Unlike DQR there is no
 * gateway confirmation: the customer scans a printed-terminal QR (or
 * deep-links into a UPI app on mobile), then taps "I've completed the
 * payment" — which commits the booking PENDING for manual verification
 * (WhatsApp screenshot / admin).
 */
export function UpiQrCheckout({
  amount,
  bookingId,
  onPaymentInitiated,
  onCancel,
  isAdvance,
  advanceAmount,
  remainingAmount,
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

  // Booking already committed on the "paid" step — a stray backdrop tap
  // must not run onCancel (which releases the hold / navigates back).
  // Same guard while the commit is in flight.
  const canDismiss = step !== "paid" && !committing;

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && canDismiss) onCancel?.();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      style={{ animation: "upiqr-fade-in 200ms ease-out" }}
      onClick={handleBackdropClick}
    >
      <style>{SHEET_KEYFRAMES}</style>
      <div className="upiqr-sheet max-h-[85vh] w-full overflow-y-auto overscroll-contain rounded-t-2xl border border-zinc-800 bg-zinc-900 text-zinc-100 sm:max-w-[400px] sm:rounded-2xl">
        {/* Header — merchant + amount, Razorpay style (matches DqrCheckout) */}
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icon.png"
              alt="Momentum Arena"
              className="h-8 w-8 shrink-0 rounded-md"
            />
            <div className="min-w-0">
              <p className="text-[15px] font-semibold leading-tight text-white">
                Momentum Arena
              </p>
              <p className="text-xs text-zinc-400">UPI payment</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[15px] font-semibold text-white">
              {formatPrice(displayAmount)}
            </span>
            {step !== "paid" && onCancel && (
              <button
                onClick={onCancel}
                disabled={committing}
                aria-label="Close"
                className="rounded-full p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>

        {isAdvance && advanceAmount != null && (
          <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-1.5 text-center text-xs text-amber-300">
            Advance {formatPrice(advanceAmount)} · Remaining at venue{" "}
            {formatPrice(
              remainingAmount ?? Math.max(0, amount - advanceAmount),
            )}
          </div>
        )}

        {/* ---------- Step 1: Scan QR (or tap through) and pay ---------- */}
        {step === "scan" && (
          <div className="flex flex-col items-center px-5 py-6">
            {/* Printed-terminal QR stays on a white card so scanners read
                it against the dark sheet (same treatment as DQR). */}
            <div className="rounded-xl bg-white p-3">
              <Image
                src={selectedQr.image}
                alt="PhonePe QR Code - Scan to Pay"
                width={240}
                height={240}
                className="rounded-lg"
                priority
              />
            </div>

            <p className="mt-4 text-2xl font-bold text-emerald-400">
              Pay {formatPrice(displayAmount)}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Sportive Ventures &middot; {selectedQr.label}
            </p>
            <p className="mt-3 text-center text-sm text-zinc-400">
              {isMobile
                ? "Scan the QR with any UPI app — or tap below to pay on this phone."
                : "Scan the QR with any UPI app on your phone."}
            </p>

            {/* Heads-up about the merchant's UPI account restriction. Our
                PhonePe Business account accepts only bank-linked UPI
                (savings/current). It rejects PPI (wallet balances), credit
                cards routed via UPI, and overdraft accounts — those payments
                show a confusing "Payment Failed" inside the UPI app even
                though the user's app sometimes pre-flashes a "Paid" toast.
                Setting expectations here saves the customer from a failed
                attempt and a frantic WhatsApp follow-up. */}
            <div className="mt-4 flex w-full items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
              <p className="text-xs leading-relaxed text-amber-200/90">
                <span className="font-semibold text-amber-300">
                  Pay from your bank-linked UPI
                </span>{" "}
                (savings/current account). Wallet balance, credit-card-on-UPI,
                and overdraft accounts aren&apos;t accepted by this merchant
                and will fail with a &quot;Payment Failed&quot; screen.
              </p>
            </div>

            {showUpiAppButton && (
              <a
                href={upiDeepLink}
                onClick={() => trackUpiAppLaunched(displayAmount)}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white transition-colors hover:bg-emerald-700"
              >
                <Smartphone className="h-5 w-5" />
                <div className="flex flex-col items-start leading-tight">
                  <span className="text-[15px]">Pay with UPI App</span>
                  <span className="text-[11px] font-normal text-emerald-50/85">
                    Opens PhonePe, GPay, Paytm, BHIM…
                  </span>
                </div>
              </a>
            )}

            {commitError && (
              <div className="mt-3 w-full rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-center text-sm text-red-400">
                {commitError}
              </div>
            )}

            <button
              onClick={handlePaymentDone}
              disabled={committing}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/40 px-4 py-3 text-[15px] font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {committing ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Reserving your slot...
                </>
              ) : (
                <>
                  <CircleCheck className="h-5 w-5" />
                  I&apos;ve completed the payment
                </>
              )}
            </button>

            <p className="mt-2 text-center text-xs text-zinc-500">
              Tap after you&apos;ve paid — this payment is verified manually
              by our team.
            </p>
          </div>
        )}

        {/* ---------- Step 2: Payment done → booking received ---------- */}
        {step === "paid" && (
          <div className="flex flex-col items-center px-6 py-8 text-center">
            <div
              className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-emerald-500"
              style={{
                animation:
                  "upiqr-check-pop 350ms cubic-bezier(0.34, 1.3, 0.64, 1) both",
              }}
            >
              <svg
                viewBox="0 0 52 52"
                className="h-8 w-8"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M14 27.5 22 35.5 38 18.5"
                  stroke="#fff"
                  strokeWidth={5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    strokeDasharray: 40,
                    strokeDashoffset: 40,
                    animation:
                      "upiqr-check-draw 300ms ease-out 200ms forwards",
                  }}
                />
              </svg>
            </div>
            <div
              className="w-full"
              style={{ animation: "upiqr-fade-in 300ms ease-out 450ms both" }}
            >
              <p className="mt-5 text-[17px] font-semibold text-white">
                Booking received
              </p>
              <p className="mt-1 text-[13px] text-zinc-400">
                We&apos;ll verify your payment shortly
              </p>

              <p className="mt-5 text-[13px] leading-relaxed text-zinc-400">
                Share a screenshot of your payment on WhatsApp so our team can
                verify and confirm your booking quickly.
              </p>

              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackUpiWhatsappClick(committedBookingId)}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-3 font-semibold text-white transition-colors hover:bg-green-700"
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
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 font-semibold text-white transition-colors hover:bg-zinc-700"
              >
                {committedBookingId ? "View Booking Details" : "My Bookings"}
              </a>

              <p className="mt-4 text-xs text-zinc-500">
                You&apos;ll receive a confirmation message once verified.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
