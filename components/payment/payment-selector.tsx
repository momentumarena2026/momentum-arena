"use client";

import { useState } from "react";
import { CreditCard, QrCode, Banknote } from "lucide-react";

export type PaymentMethodType = "razorpay" | "upi_qr" | "cash";

interface PaymentSelectorProps {
  selected: PaymentMethodType;
  onSelect: (method: PaymentMethodType) => void;
}

const methods = [
  {
    id: "razorpay" as const,
    name: "Pay Online",
    description: "Cards, UPI, Netbanking via Razorpay",
    icon: CreditCard,
    color: "blue",
  },
  {
    id: "upi_qr" as const,
    name: "UPI QR Code",
    description: "Scan QR & send screenshot on WhatsApp",
    icon: QrCode,
    color: "green",
  },
  {
    id: "cash" as const,
    name: "Pay at Venue",
    description: "20% advance online, rest in cash at venue",
    icon: Banknote,
    color: "yellow",
  },
];

const colorMap: Record<string, { border: string; bg: string; icon: string }> = {
  blue: {
    border: "border-blue-400 ring-blue-400/50",
    bg: "bg-blue-500/10",
    icon: "text-blue-400",
  },
  green: {
    border: "border-emerald-400 ring-emerald-400/50",
    bg: "bg-emerald-500/10",
    icon: "text-emerald-400",
  },
  yellow: {
    border: "border-yellow-400 ring-yellow-400/50",
    bg: "bg-yellow-500/10",
    icon: "text-yellow-400",
  },
};

export function PaymentSelector({ selected, onSelect }: PaymentSelectorProps) {
  return (
    <div className="space-y-3">
      {methods.map((method) => {
        const isSelected = selected === method.id;
        const colors = colorMap[method.color];
        const Icon = method.icon;

        return (
          <button
            key={method.id}
            onClick={() => onSelect(method.id)}
            className={`w-full rounded-xl border p-4 text-left transition-all duration-200 ${
              isSelected
                ? `${colors.border} ${colors.bg} ring-1`
                : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`rounded-lg p-2 ${
                  isSelected ? colors.bg : "bg-zinc-800"
                }`}
              >
                <Icon
                  className={`h-5 w-5 ${
                    isSelected ? colors.icon : "text-zinc-400"
                  }`}
                />
              </div>
              <div>
                <p className="font-medium text-white">{method.name}</p>
                <p className="text-xs text-zinc-400">{method.description}</p>
              </div>
              <div className="ml-auto">
                <div
                  className={`h-5 w-5 rounded-full border-2 transition-all ${
                    isSelected
                      ? `${colors.border} bg-current`
                      : "border-zinc-600"
                  }`}
                >
                  {isSelected && (
                    <div className="flex h-full items-center justify-center">
                      <div className="h-2 w-2 rounded-full bg-white" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
