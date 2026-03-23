"use client";

import { CreditCard, QrCode } from "lucide-react";
import { formatPrice } from "@/lib/pricing";

export type AdvancePaymentMethod = "razorpay" | "upi_qr";

interface AdvancePaymentSelectorProps {
  totalAmount: number;
  advanceAmount: number;
  remainingAmount: number;
  selected: AdvancePaymentMethod;
  onSelect: (method: AdvancePaymentMethod) => void;
}

export function AdvancePaymentSelector({
  totalAmount,
  advanceAmount,
  remainingAmount,
  selected,
  onSelect,
}: AdvancePaymentSelectorProps) {
  return (
    <div className="space-y-3">
      {/* Advance Info */}
      <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">
        <p className="text-sm font-medium text-yellow-400">
          20% Advance Required
        </p>
        <div className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between text-zinc-400">
            <span>Total</span>
            <span>{formatPrice(totalAmount)}</span>
          </div>
          <div className="flex justify-between text-yellow-300 font-medium">
            <span>Advance (20%)</span>
            <span>{formatPrice(advanceAmount)}</span>
          </div>
          <div className="flex justify-between text-zinc-500">
            <span>Due at Venue</span>
            <span>{formatPrice(remainingAmount)}</span>
          </div>
        </div>
      </div>

      {/* Advance Method Selection */}
      <p className="text-xs text-zinc-500">Pay advance via:</p>
      <div className="flex gap-2">
        <button
          onClick={() => onSelect("razorpay")}
          className={`flex-1 flex items-center justify-center gap-2 rounded-xl border p-3 transition-all ${
            selected === "razorpay"
              ? "border-blue-400 bg-blue-500/10 ring-1 ring-blue-400/50"
              : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"
          }`}
        >
          <CreditCard className={`h-4 w-4 ${selected === "razorpay" ? "text-blue-400" : "text-zinc-400"}`} />
          <span className={`text-sm ${selected === "razorpay" ? "text-white" : "text-zinc-400"}`}>
            Pay Online
          </span>
        </button>
        <button
          onClick={() => onSelect("upi_qr")}
          className={`flex-1 flex items-center justify-center gap-2 rounded-xl border p-3 transition-all ${
            selected === "upi_qr"
              ? "border-emerald-400 bg-emerald-500/10 ring-1 ring-emerald-400/50"
              : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"
          }`}
        >
          <QrCode className={`h-4 w-4 ${selected === "upi_qr" ? "text-emerald-400" : "text-zinc-400"}`} />
          <span className={`text-sm ${selected === "upi_qr" ? "text-white" : "text-zinc-400"}`}>
            UPI QR
          </span>
        </button>
      </div>
    </div>
  );
}
