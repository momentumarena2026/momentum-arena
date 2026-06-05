"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCafePaymentSplit } from "@/actions/admin-cafe-orders";
import { CheckCircle2, Loader2, SplitSquareHorizontal, Tag } from "lucide-react";

/**
 * Re-attribute the already-collected cafe payment between Cash,
 * UPI and Discount. Direct port of the booking-side
 * EditSplitButton — appears on the green "Paid in Full" block of
 * a COMPLETED cafe payment.
 *
 * Validation rules mirror the booking action's:
 *   - sum(cash + upi + discount) must equal order total
 *   - cash + upi must be > 0 (100%-discount = refund-shaped, rejected)
 *   - new triple must differ from the prior triple (no-op detection)
 */
export function EditCafeSplitButton({
  orderId,
  totalAmount,
  initialCash,
  initialUpi,
  initialDiscount,
}: {
  orderId: string;
  totalAmount: number;
  initialCash: number;
  initialUpi: number;
  initialDiscount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [cashStr, setCashStr] = useState(String(initialCash));
  const [upiStr, setUpiStr] = useState(String(initialUpi));
  const [discountStr, setDiscountStr] = useState(
    initialDiscount > 0 ? String(initialDiscount) : "",
  );

  function openForm() {
    if (isPending) return;
    setError(null);
    setCashStr(String(initialCash));
    setUpiStr(String(initialUpi));
    setDiscountStr(initialDiscount > 0 ? String(initialDiscount) : "");
    setOpen(true);
  }

  if (!open) {
    return (
      <button
        onClick={openForm}
        disabled={isPending}
        className="mt-2 flex items-center justify-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-[11px] font-semibold text-sky-300 transition-colors hover:bg-sky-500/20 disabled:opacity-60"
      >
        <SplitSquareHorizontal className="h-3 w-3" />
        Edit collection split
      </button>
    );
  }

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
  const diffsFromInitial =
    cashN !== initialCash ||
    upiN !== initialUpi ||
    discountN !== initialDiscount;
  const canSubmit =
    cashValid &&
    upiValid &&
    discountValid &&
    Math.abs(sum - totalAmount) < 0.01 &&
    cashN + upiN > 0 &&
    diffsFromInitial;

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await updateCafePaymentSplit(orderId, {
        cashAmount: cashN,
        upiAmount: upiN,
        discountAmount: discountN,
      });
      if (result.success) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error || "Failed to update split");
      }
    });
  }

  return (
    <div className="mt-2 space-y-2">
      <p className="text-[11px] font-medium text-amber-200">
        Re-attribute ₹{totalAmount.toLocaleString("en-IN")}:
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
        onClick={submit}
        disabled={!canSubmit || isPending}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5" />
        )}
        Save split
      </button>
      <button
        onClick={() => setOpen(false)}
        disabled={isPending}
        className="block w-full text-center text-[11px] text-zinc-500 hover:text-zinc-300 disabled:opacity-60"
      >
        Cancel
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
