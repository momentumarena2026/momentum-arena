"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markCafePaymentCollected } from "@/actions/admin-cafe-orders";
import {
  CheckCircle2,
  Loader2,
  Banknote,
  QrCode,
  SplitSquareHorizontal,
  Tag,
} from "lucide-react";

type Mode = "picker" | "split";

/**
 * Two-step interaction on a PENDING cafe-payment row of the admin
 * order detail page — direct port of the booking-side
 * MarkCollectedButton:
 *
 *   1. Click "Mark ₹X collected at counter" → method picker
 *      (Cash / UPI QR / Split).
 *   2a. Cash or UPI → one-shot with the full amount on that side.
 *   2b. Split → enter cash + UPI + discount amounts; confirm when
 *       the three sum to the order total.
 *
 * On success the parent page refreshes so the block flips to the
 * emerald "Paid in Full" state.
 */
export function MarkCafePaidButton({
  orderId,
  totalAmount,
  formattedTotal,
}: {
  orderId: string;
  totalAmount: number;
  formattedTotal: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("picker");
  const [cashStr, setCashStr] = useState("");
  const [upiStr, setUpiStr] = useState("");
  const [discountStr, setDiscountStr] = useState("");

  function openPicker() {
    if (isPending) return;
    setError(null);
    setMode("picker");
    setCashStr("");
    setUpiStr("");
    setDiscountStr("");
    setOpen(true);
  }

  function submit(
    cashAmount: number,
    upiAmount: number,
    discountAmount: number = 0,
  ) {
    setError(null);
    startTransition(async () => {
      const result = await markCafePaymentCollected(orderId, {
        cashAmount,
        upiAmount,
        discountAmount,
      });
      if (result.success) {
        router.refresh();
      } else {
        setError(result.error || "Failed to record collection");
      }
    });
  }

  if (totalAmount <= 0) return null;

  if (!open) {
    return (
      <div className="mt-2 space-y-2">
        <button
          onClick={openPicker}
          disabled={isPending}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/20 px-3 py-2 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/30 disabled:opacity-60"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Mark {formattedTotal} collected at counter
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  if (mode === "picker") {
    return (
      <div className="mt-2 space-y-2">
        <p className="text-[11px] font-medium text-amber-200">
          Collected {formattedTotal} via:
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => submit(totalAmount, 0)}
            disabled={isPending}
            className="flex items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-60"
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Banknote className="h-3.5 w-3.5" />
            )}
            Cash
          </button>
          <button
            onClick={() => submit(0, totalAmount)}
            disabled={isPending}
            className="flex items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-60"
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <QrCode className="h-3.5 w-3.5" />
            )}
            UPI QR
          </button>
        </div>
        <button
          onClick={() => {
            setError(null);
            setMode("split");
          }}
          disabled={isPending}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-300 transition-colors hover:bg-sky-500/20 disabled:opacity-60"
        >
          <SplitSquareHorizontal className="h-3.5 w-3.5" />
          Split (Cash + UPI QR)
        </button>
        {!isPending && (
          <button
            onClick={() => setOpen(false)}
            className="block w-full text-center text-[11px] text-zinc-500 hover:text-zinc-300"
          >
            Cancel
          </button>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  // Split entry mode — three legs (Cash, UPI QR, Discount). The
  // discount slice is optional; when omitted the previous two-input
  // behaviour is preserved exactly. Cash + UPI must still be > 0 —
  // a 100%-discount collection is a refund-shaped operation and the
  // action rejects it.
  const cash = Number(cashStr);
  const upi = Number(upiStr);
  const discount = Number(discountStr);
  const cashValid = !Number.isNaN(cash) && cash >= 0;
  const upiValid = !Number.isNaN(upi) && upi >= 0;
  const discountValid =
    discountStr === "" || (!Number.isNaN(discount) && discount >= 0);
  const cashN = cashValid ? cash : 0;
  const upiN = upiValid ? upi : 0;
  const discountN =
    discountStr === "" || Number.isNaN(discount) ? 0 : discount;
  const sum = cashN + upiN + discountN;
  const canSubmit =
    cashValid &&
    upiValid &&
    discountValid &&
    Math.abs(sum - totalAmount) < 0.01 &&
    cashN + upiN > 0;

  return (
    <div className="mt-2 space-y-2">
      <p className="text-[11px] font-medium text-amber-200">
        Split {formattedTotal}:
      </p>
      <div className="grid grid-cols-3 gap-2">
        <label className="space-y-1">
          <span className="block text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            Cash ₹
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step="0.01"
            value={cashStr}
            onChange={(e) => setCashStr(e.target.value)}
            disabled={isPending}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs font-semibold text-white placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
            placeholder="0"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            UPI QR ₹
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step="0.01"
            value={upiStr}
            onChange={(e) => setUpiStr(e.target.value)}
            disabled={isPending}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs font-semibold text-white placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
            placeholder="0"
          />
        </label>
        <label className="space-y-1">
          <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            <Tag className="h-2.5 w-2.5" />
            Discount ₹
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step="0.01"
            value={discountStr}
            onChange={(e) => setDiscountStr(e.target.value)}
            disabled={isPending}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs font-semibold text-white placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
            placeholder="0"
          />
        </label>
      </div>
      <p
        className={`text-[11px] ${
          Math.abs(sum - totalAmount) < 0.01
            ? "text-emerald-400"
            : sum > totalAmount
            ? "text-red-400"
            : "text-zinc-500"
        }`}
      >
        Sum: ₹{sum.toLocaleString("en-IN")} / ₹{totalAmount.toLocaleString("en-IN")}
        {discountN > 0 ? (
          <span className="ml-2 text-zinc-500">
            (collected ₹{(cashN + upiN).toLocaleString("en-IN")})
          </span>
        ) : null}
      </p>
      <button
        onClick={() => submit(cashN, upiN, discountN)}
        disabled={!canSubmit || isPending}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5" />
        )}
        Confirm split collection
      </button>
      <div className="flex items-center justify-between">
        <button
          onClick={() => {
            setError(null);
            setMode("picker");
          }}
          disabled={isPending}
          className="text-[11px] text-zinc-500 hover:text-zinc-300 disabled:opacity-60"
        >
          ← Back
        </button>
        {!isPending && (
          <button
            onClick={() => setOpen(false)}
            className="text-[11px] text-zinc-500 hover:text-zinc-300"
          >
            Cancel
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
