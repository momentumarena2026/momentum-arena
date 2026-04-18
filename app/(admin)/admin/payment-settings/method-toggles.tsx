"use client";

import { useState, useTransition } from "react";
import { CreditCard, QrCode, Wallet } from "lucide-react";
import {
  setPaymentMethodEnabled,
  type PaymentMethodFlag,
} from "@/actions/admin-payment-settings";

interface Props {
  onlineEnabled: boolean;
  upiQrEnabled: boolean;
  advanceEnabled: boolean;
}

type ToggleKey = "online" | "upi_qr" | "advance";

interface Row {
  key: ToggleKey;
  label: string;
  description: string;
  Icon: typeof CreditCard;
}

const ROWS: Row[] = [
  {
    key: "online",
    label: "Online Payment",
    description: "Cards, UPI, Netbanking via the active gateway (PhonePe / Razorpay)",
    Icon: CreditCard,
  },
  {
    key: "upi_qr",
    label: "UPI QR Code",
    description: "Customer scans a QR and enters the UTR manually",
    Icon: QrCode,
  },
  {
    key: "advance",
    label: "Pay 50% Now, 50% at Venue",
    description: "Customer pays a 50% advance online; staff collects the rest on arrival",
    Icon: Wallet,
  },
];

export function PaymentMethodToggles({
  onlineEnabled,
  upiQrEnabled,
  advanceEnabled,
}: Props) {
  const [state, setState] = useState({
    online: onlineEnabled,
    upi_qr: upiQrEnabled,
    advance: advanceEnabled,
  });
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pendingKey, setPendingKey] = useState<ToggleKey | null>(null);

  function toggle(key: ToggleKey) {
    const previous = { ...state };
    const next = { ...state, [key]: !state[key] };
    setState(next);
    setMessage(null);
    setPendingKey(key);
    startTransition(async () => {
      const result = await setPaymentMethodEnabled(
        key as PaymentMethodFlag,
        next[key]
      );
      setPendingKey(null);
      if (!result.success) {
        setState(previous); // revert
        setMessage({ kind: "err", text: result.error || "Failed to update" });
      } else {
        setMessage({
          kind: "ok",
          text: `${ROWS.find((r) => r.key === key)?.label} ${next[key] ? "enabled" : "disabled"}`,
        });
      }
    });
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wider">
        Payment Methods at Checkout
      </h2>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 divide-y divide-zinc-800">
        {ROWS.map((row) => {
          const enabled = state[row.key];
          const rowPending = isPending && pendingKey === row.key;
          return (
            <div
              key={row.key}
              className="flex items-center gap-4 p-4"
            >
              <div
                className={`rounded-lg p-2 ${
                  enabled ? "bg-emerald-500/10" : "bg-zinc-800"
                }`}
              >
                <row.Icon
                  className={`h-5 w-5 ${
                    enabled ? "text-emerald-400" : "text-zinc-500"
                  }`}
                />
              </div>
              <div className="flex-1">
                <p className={`font-medium ${enabled ? "text-white" : "text-zinc-500"}`}>
                  {row.label}
                </p>
                <p className="text-xs text-zinc-500">{row.description}</p>
              </div>
              <button
                onClick={() => toggle(row.key)}
                disabled={isPending}
                aria-pressed={enabled}
                className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${
                  enabled ? "bg-emerald-500" : "bg-zinc-700"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                    enabled ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
                {rowPending && (
                  <span className="sr-only">Saving...</span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {message && (
        <p
          className={`text-sm ${
            message.kind === "ok" ? "text-emerald-400" : "text-red-400"
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-500">
        <p>
          At least one payment method must stay enabled at all times so
          customers can complete checkout. Disabled methods hide their tile
          from the checkout page immediately; bookings already in progress
          are unaffected.
        </p>
      </div>
    </div>
  );
}
