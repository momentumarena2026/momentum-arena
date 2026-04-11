"use client";

import { useState, useEffect, useMemo } from "react";
import { Clock, AlertTriangle, MessageCircle, CheckCircle2 } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import Image from "next/image";
import { formatPrice } from "@/lib/pricing";

interface UpiQrCheckoutProps {
  amount: number;
  bookingId?: string;
  onPaymentInitiated?: () => void;
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
const TIMER_DURATION = 30 * 60; // 30 minutes in seconds

export function UpiQrCheckout({
  amount,
  bookingId,
  onPaymentInitiated,
  isAdvance,
  advanceAmount,
  qrType = "turf",
}: UpiQrCheckoutProps) {
  const [secondsLeft, setSecondsLeft] = useState(TIMER_DURATION);
  const [expired, setExpired] = useState(false);
  const [screenshotSent, setScreenshotSent] = useState(false);

  // Pick a random QR on mount (stable across re-renders)
  const selectedQr = useMemo(() => {
    const options = qrType === "cafe" ? CAFE_QR_OPTIONS : TURF_QR_OPTIONS;
    return options[Math.floor(Math.random() * options.length)];
  }, [qrType]);

  const displayAmount = isAdvance && advanceAmount ? advanceAmount : amount;

  // WhatsApp URL
  const whatsappMessage = encodeURIComponent(
    bookingId
      ? `Hi, I've made a payment of ${formatPrice(displayAmount)} for Booking #${bookingId.slice(-8)}.\n\nPlease find the payment screenshot attached. Kindly confirm my booking.`
      : `Hi, I've made a payment of ${formatPrice(displayAmount)}.\n\nPlease find the payment screenshot attached. Kindly confirm my booking.`
  );
  const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${whatsappMessage}`;

  // Countdown timer
  useEffect(() => {
    if (expired) return;
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setExpired(true);
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [expired]);

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const handleScreenshotSent = () => {
    setScreenshotSent(true);
    onPaymentInitiated?.();
  };

  if (expired) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-red-500/30 bg-zinc-900 p-8 text-center">
        <AlertTriangle className="h-12 w-12 text-red-400 mb-4" />
        <h3 className="text-lg font-semibold text-white mb-2">
          Payment Window Expired
        </h3>
        <p className="text-sm text-zinc-400">
          The 30-minute payment window has expired. Please go back and try
          again.
        </p>
      </div>
    );
  }

  if (screenshotSent) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-emerald-500/30 bg-zinc-900 p-8 text-center space-y-4">
        <CheckCircle2 className="h-12 w-12 text-emerald-400" />
        <h3 className="text-lg font-semibold text-white">
          Slot Locked for 30 Minutes
        </h3>
        <p className="text-sm text-zinc-400 max-w-xs">
          Your slot is temporarily held. Once our team verifies your payment screenshot, your booking will be confirmed.
        </p>
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2.5">
          <Clock className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-medium text-amber-400">
            Slot held for{" "}
            <span className="font-mono font-bold">{formatTime(secondsLeft)}</span>
          </span>
        </div>
        <p className="text-xs text-zinc-500">
          You&apos;ll receive a confirmation message once verified.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Timer */}
      <div className="flex items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2.5">
        <Clock className="h-4 w-4 text-amber-400" />
        <span className="text-sm font-medium text-amber-400">
          Slot locked for{" "}
          <span className="font-mono font-bold">{formatTime(secondsLeft)}</span>{" "}
          minutes
        </span>
      </div>

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

      {/* WhatsApp Screenshot Instructions */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-white flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-emerald-400" />
            After Payment
          </h4>
          <div className="space-y-2 text-sm text-zinc-400">
            <p className="flex items-start gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-xs font-bold text-emerald-400">1</span>
              Pay the exact amount by scanning the QR above
            </p>
            <p className="flex items-start gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-xs font-bold text-emerald-400">2</span>
              Take a screenshot of the payment confirmation
            </p>
            <p className="flex items-start gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-xs font-bold text-emerald-400">3</span>
              Share the screenshot on our WhatsApp number below
            </p>
          </div>
        </div>

        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleScreenshotSent}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-3.5 font-semibold text-white transition-colors hover:bg-green-700"
        >
          <FaWhatsapp className="h-5 w-5" />
          Share Screenshot on WhatsApp
        </a>

        <p className="text-center text-xs text-zinc-500">
          Your slot is locked for 30 minutes. Our team will verify the payment and confirm your booking.
        </p>
      </div>
    </div>
  );
}
