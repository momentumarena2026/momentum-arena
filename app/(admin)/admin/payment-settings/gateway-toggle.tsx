"use client";

import { useState, useTransition } from "react";
import { setActivePaymentGateway } from "@/actions/admin-payment-settings";
import type { PaymentGateway } from "@prisma/client";

const gateways: { id: PaymentGateway; name: string; description: string }[] = [
  {
    id: "PHONEPE",
    name: "PhonePe",
    description: "UPI, Cards, Netbanking via PhonePe Payment Gateway",
  },
  {
    id: "RAZORPAY",
    name: "Razorpay",
    description: "UPI, Cards, Netbanking via Razorpay Payment Gateway",
  },
];

export function PaymentGatewayToggle({
  activeGateway,
}: {
  activeGateway: PaymentGateway;
}) {
  const [selected, setSelected] = useState<PaymentGateway>(activeGateway);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  function handleSelect(gateway: PaymentGateway) {
    if (gateway === selected) return;
    setSelected(gateway);
    setMessage("");
    startTransition(async () => {
      const result = await setActivePaymentGateway(gateway);
      if (result.success) {
        setMessage(`Switched to ${gateway === "PHONEPE" ? "PhonePe" : "Razorpay"}`);
      } else {
        setSelected(activeGateway); // revert
        setMessage(result.error || "Failed to update");
      }
    });
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wider">
        Active Payment Gateway
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        {gateways.map((gw) => {
          const isActive = selected === gw.id;
          return (
            <button
              key={gw.id}
              onClick={() => handleSelect(gw.id)}
              disabled={isPending}
              className={`rounded-xl border p-5 text-left transition-all ${
                isActive
                  ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/30"
                  : "border-zinc-700 bg-zinc-900 hover:border-zinc-600"
              } disabled:opacity-50`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold text-white">{gw.name}</p>
                  <p className="mt-1 text-sm text-zinc-400">{gw.description}</p>
                </div>
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${
                    isActive ? "border-emerald-400" : "border-zinc-600"
                  }`}
                >
                  {isActive && (
                    <div className="h-3 w-3 rounded-full bg-emerald-400" />
                  )}
                </div>
              </div>
              {isActive && (
                <span className="mt-3 inline-block rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400 border border-emerald-500/30">
                  Active
                </span>
              )}
            </button>
          );
        })}
      </div>

      {isPending && (
        <p className="text-sm text-zinc-400">Saving...</p>
      )}
      {message && !isPending && (
        <p className="text-sm text-emerald-400">{message}</p>
      )}

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-500">
        <p>
          The active gateway is used for all online payments (full payment and
          advance). UPI QR and Cash payment options are always available
          regardless of gateway selection.
        </p>
      </div>
    </div>
  );
}
