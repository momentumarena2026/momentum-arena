"use client";

import { CreditCard, QrCode, Wallet, Check } from "lucide-react";
import { formatPrice } from "@/lib/pricing";

/** Top-level choice: pay the full amount now, or a 50% advance. */
export type AmountMode = "full" | "advance";
/** Method choice under each amount mode. `upi` = direct UPI (no fee). */
export type PayMethod = "upi" | "gateway";

interface PaymentSelectorProps {
  amountMode: AmountMode;
  onAmountModeChange: (m: AmountMode) => void;
  method: PayMethod;
  onMethodChange: (m: PayMethod) => void;
  gateway: "PHONEPE" | "RAZORPAY";
  fullAmount: number;
  advanceAmount: number;
  remainingAmount: number;
  // Admin-controlled enablement. onlineEnabled → gateway method,
  // upiQrEnabled → UPI method, advanceEnabled → the 50% top card.
  onlineEnabled?: boolean;
  upiQrEnabled?: boolean;
  advanceEnabled?: boolean;
}

/**
 * Two-level payment chooser:
 *   1. Amount — "Pay Full" vs "Pay 50% Now, rest at Venue".
 *   2. Method — "UPI" (pre-selected, no extra charge) vs the gateway
 *      (cards / netbanking via PhonePe / Razorpay).
 *
 * UPI is the default to steer customers away from the fee-bearing
 * gateway. The method toggle only renders when both methods are
 * enabled; with one enabled it's implicit.
 */
export function PaymentSelector({
  amountMode,
  onAmountModeChange,
  method,
  onMethodChange,
  gateway,
  fullAmount,
  advanceAmount,
  remainingAmount,
  onlineEnabled = true,
  upiQrEnabled = true,
  advanceEnabled = true,
}: PaymentSelectorProps) {
  const showMethodToggle = upiQrEnabled && onlineEnabled;

  const cards: Array<{
    id: AmountMode;
    enabled: boolean;
    title: string;
    desc: string;
  }> = [
    {
      id: "full",
      enabled: onlineEnabled || upiQrEnabled,
      title: "Pay Full",
      desc: `Pay ${formatPrice(fullAmount)} now`,
    },
    {
      id: "advance",
      enabled: advanceEnabled,
      title: "Pay 50% Now, rest at Venue",
      desc: `${formatPrice(advanceAmount)} now · ${formatPrice(remainingAmount)} at venue`,
    },
  ];

  return (
    <div className="space-y-3">
      {cards
        .filter((c) => c.enabled)
        .map((card) => {
          const isSelected = amountMode === card.id;
          return (
            <div
              key={card.id}
              className={`rounded-xl border transition-all duration-200 ${
                isSelected
                  ? "border-emerald-400 bg-emerald-500/5 ring-1 ring-emerald-400/40"
                  : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"
              }`}
            >
              <button
                onClick={() => onAmountModeChange(card.id)}
                className="flex w-full items-center gap-3 p-4 text-left"
              >
                <div
                  className={`rounded-lg p-2 ${isSelected ? "bg-emerald-500/10" : "bg-zinc-800"}`}
                >
                  <Wallet
                    className={`h-5 w-5 ${isSelected ? "text-emerald-400" : "text-zinc-400"}`}
                  />
                </div>
                <div>
                  <p className="font-medium text-white">{card.title}</p>
                  <p className="text-xs text-zinc-400">{card.desc}</p>
                </div>
                <div className="ml-auto">
                  <div
                    className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all ${
                      isSelected ? "border-emerald-400 bg-emerald-400" : "border-zinc-600"
                    }`}
                  >
                    {isSelected && <div className="h-2 w-2 rounded-full bg-white" />}
                  </div>
                </div>
              </button>

              {/* Method sub-choice — only under the selected card. */}
              {isSelected && showMethodToggle && (
                <div className="border-t border-zinc-800 p-3">
                  <MethodToggle
                    method={method}
                    onMethodChange={onMethodChange}
                    gateway={gateway}
                  />
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}

function MethodToggle({
  method,
  onMethodChange,
  gateway,
}: {
  method: PayMethod;
  onMethodChange: (m: PayMethod) => void;
  gateway: "PHONEPE" | "RAZORPAY";
}) {
  const options: Array<{
    id: PayMethod;
    label: string;
    sub: string;
    Icon: typeof QrCode;
  }> = [
    {
      id: "upi",
      label: "UPI",
      sub: "Recommended · no extra charge",
      Icon: QrCode,
    },
    {
      id: "gateway",
      label: gateway === "PHONEPE" ? "PhonePe" : "Card / Netbanking",
      sub: "Cards, UPI, Netbanking",
      Icon: CreditCard,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((o) => {
        const active = method === o.id;
        return (
          <button
            key={o.id}
            onClick={() => onMethodChange(o.id)}
            className={`relative flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all ${
              active
                ? "border-emerald-400 bg-emerald-500/10"
                : "border-zinc-700 bg-zinc-900 hover:border-zinc-500"
            }`}
          >
            <div className="flex w-full items-center gap-2">
              <o.Icon className={`h-4 w-4 ${active ? "text-emerald-400" : "text-zinc-400"}`} />
              <span className={`text-sm font-semibold ${active ? "text-white" : "text-zinc-300"}`}>
                {o.label}
              </span>
              {active && <Check className="ml-auto h-4 w-4 text-emerald-400" />}
            </div>
            <span className={`text-[11px] ${active ? "text-emerald-300/80" : "text-zinc-500"}`}>
              {o.sub}
            </span>
          </button>
        );
      })}
    </div>
  );
}
