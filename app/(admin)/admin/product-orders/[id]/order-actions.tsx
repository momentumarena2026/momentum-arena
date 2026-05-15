"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, PackageCheck, X } from "lucide-react";
import {
  adminCancelOrder,
  adminConfirmOrderPayment,
  adminMarkFulfilled,
} from "@/actions/shop-order";

interface Props {
  orderId: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  hasUtr: boolean;
}

/**
 * Admin actions panel for a single order. Surfaces only the buttons
 * relevant to the current state — confirm payment is hidden once
 * the order is CONFIRMED, fulfilled only available from CONFIRMED,
 * cancel kept available until the order is terminal.
 */
export function OrderActions({
  orderId,
  status,
  paymentMethod,
  paymentStatus,
  hasUtr,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [utrDraft, setUtrDraft] = useState("");
  const [showUtrInput, setShowUtrInput] = useState(false);

  const canConfirm =
    status === "PENDING" &&
    paymentStatus !== "COMPLETED" &&
    (paymentMethod === "UPI_QR" || paymentMethod === "CASH");
  const canFulfil = status === "CONFIRMED";
  const canCancel = status !== "CANCELLED" && status !== "REFUNDED";

  function handleConfirm() {
    if (paymentMethod === "UPI_QR" && !hasUtr && !showUtrInput) {
      setShowUtrInput(true);
      return;
    }
    startTransition(async () => {
      const res = await adminConfirmOrderPayment({
        orderId,
        utrNumber:
          paymentMethod === "UPI_QR" && utrDraft.trim()
            ? utrDraft.trim()
            : undefined,
      });
      if (!res.success) {
        setError(res.error ?? "Confirm failed");
        return;
      }
      setShowUtrInput(false);
      setUtrDraft("");
      router.refresh();
    });
  }

  function handleFulfil() {
    if (!confirm("Mark this order as collected by the customer?")) return;
    startTransition(async () => {
      const res = await adminMarkFulfilled(orderId);
      if (!res.success) {
        setError(res.error ?? "Fulfilment failed");
        return;
      }
      router.refresh();
    });
  }

  function handleCancel() {
    const reason = prompt(
      "Cancel order? Stock will be released back to inventory unless the order is already fulfilled (in which case this becomes a REFUND). Enter a short reason:",
      "",
    );
    if (reason === null) return;
    if (!reason.trim()) {
      alert("A reason is required.");
      return;
    }
    startTransition(async () => {
      const res = await adminCancelOrder(orderId, reason.trim());
      if (!res.success) {
        setError(res.error ?? "Cancel failed");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
        Admin actions
      </h2>
      <div className="flex flex-wrap gap-2">
        {canConfirm ? (
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm font-semibold text-emerald-300 hover:border-emerald-400 disabled:opacity-60"
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            {paymentMethod === "UPI_QR"
              ? hasUtr
                ? "Confirm payment"
                : "Confirm UPI payment"
              : "Confirm cash"}
          </button>
        ) : null}
        {canFulfil ? (
          <button
            type="button"
            onClick={handleFulfil}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm font-semibold text-emerald-300 hover:border-emerald-400 disabled:opacity-60"
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PackageCheck className="h-3.5 w-3.5" />
            )}
            Mark fulfilled
          </button>
        ) : null}
        {canCancel ? (
          <button
            type="button"
            onClick={handleCancel}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-sm font-semibold text-red-300 hover:border-red-400 disabled:opacity-60"
          >
            <X className="h-3.5 w-3.5" />
            {status === "FULFILLED" ? "Refund / cancel" : "Cancel order"}
          </button>
        ) : null}
      </div>

      {showUtrInput ? (
        <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950 p-3">
          <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            UTR number (optional but recommended)
          </label>
          <input
            value={utrDraft}
            onChange={(e) => setUtrDraft(e.target.value)}
            placeholder="12-digit UPI transaction reference"
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
          />
          <div className="mt-2 flex justify-end gap-2 text-xs">
            <button
              type="button"
              onClick={() => {
                setShowUtrInput(false);
                setUtrDraft("");
              }}
              className="rounded-md border border-zinc-700 px-2.5 py-1 text-zinc-300 hover:border-zinc-500"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isPending}
              className="rounded-md bg-emerald-600 px-2.5 py-1 font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              Confirm
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
