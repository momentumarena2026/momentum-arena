"use client";

import { QrCode, MessageCircle, Copy, Check } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { useState } from "react";
import { formatPrice } from "@/lib/pricing";

interface UpiQrProps {
  amount: number;
  bookingId: string;
  qrImageUrl?: string;
}

export function UpiQr({ amount, bookingId, qrImageUrl = "/YesPay.png" }: UpiQrProps) {
  const [copied, setCopied] = useState(false);
  const whatsappNumber = "916396177261";
  const whatsappMessage = encodeURIComponent(
    `Payment for Booking #${bookingId}\nAmount: ${formatPrice(amount)}\n\nPlease find the payment screenshot attached.`
  );
  const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${whatsappMessage}`;

  const copyBookingId = () => {
    navigator.clipboard.writeText(bookingId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* QR Code */}
      <div className="flex flex-col items-center rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        {qrImageUrl ? (
          <img
            src={qrImageUrl}
            alt="UPI QR Code"
            className="h-48 w-48 rounded-lg bg-white p-2"
          />
        ) : (
          <div className="flex h-48 w-48 items-center justify-center rounded-lg bg-white/10 border border-dashed border-zinc-600">
            <div className="text-center">
              <QrCode className="mx-auto h-12 w-12 text-zinc-500" />
              <p className="mt-2 text-xs text-zinc-500">QR Code</p>
              <p className="text-xs text-zinc-600">(Admin will upload)</p>
            </div>
          </div>
        )}

        <p className="mt-4 text-2xl font-bold text-emerald-400">
          {formatPrice(amount)}
        </p>
        <p className="text-sm text-zinc-400">Scan & pay via any UPI app</p>
      </div>

      {/* Booking ID */}
      <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 p-3">
        <div>
          <p className="text-xs text-zinc-500">Booking ID</p>
          <p className="font-mono text-sm text-zinc-300">{bookingId}</p>
        </div>
        <button
          onClick={copyBookingId}
          className="rounded-lg border border-zinc-700 p-2 hover:bg-zinc-800"
        >
          {copied ? (
            <Check className="h-4 w-4 text-emerald-400" />
          ) : (
            <Copy className="h-4 w-4 text-zinc-400" />
          )}
        </button>
      </div>

      {/* WhatsApp */}
      <a
        href={whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-3 font-medium text-white transition-colors hover:bg-green-700"
      >
        <FaWhatsapp className="h-5 w-5" />
        Send Screenshot on WhatsApp
      </a>

      <p className="text-center text-xs text-zinc-500">
        After payment, send the screenshot to our WhatsApp. Your booking will be
        confirmed once we verify the payment.
      </p>
    </div>
  );
}
