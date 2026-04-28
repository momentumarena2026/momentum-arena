"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateRemainderSplit } from "@/actions/admin-booking";
import { Pencil, CheckCircle2, Loader2, Tag } from "lucide-react";

/**
 * Shown on the emerald "Paid in Full" block of a partial-payment booking
 * whose remainder has already been collected. Lets the admin re-attribute
 * the same venue total between Cash, UPI QR, and an optional discount
 * when they realize the original entry was wrong. Discount is the
 * goodwill cut the venue absorbed at collection time; bumping it up
 * here will shrink Payment.amount accordingly so reporting stays honest.
 */
export function EditSplitButton({
  bookingId,
  venueTotal,
  initialCash,
  initialUpi,
  initialDiscount,
}: {
  bookingId: string;
  venueTotal: number;
  initialCash: number;
  initialUpi: number;
  initialDiscount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [cashStr, setCashStr] = useState(initialCash.toString());
  const [upiStr, setUpiStr] = useState(initialUpi.toString());
  const [discountStr, setDiscountStr] = useState(initialDiscount.toString());

  function submit() {
    const cash = parseInt(cashStr, 10);
    const upi = parseInt(upiStr, 10);
    const discount = parseInt(discountStr, 10);
    setError(null);
    startTransition(async () => {
      const result = await updateRemainderSplit(bookingId, {
        cashAmount: isNaN(cash) ? 0 : cash,
        upiAmount: isNaN(upi) ? 0 : upi,
        discountAmount: isNaN(discount) ? 0 : discount,
      });
      if (result.success) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error || "Failed to update split");
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => {
          setCashStr(initialCash.toString());
          setUpiStr(initialUpi.toString());
          setDiscountStr(initialDiscount.toString());
          setError(null);
          setOpen(true);
        }}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/40 px-3 py-1.5 text-[11px] font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
      >
        <Pencil className="h-3 w-3" />
        Edit collection split
      </button>
    );
  }

  const cash = parseInt(cashStr, 10);
  const upi = parseInt(upiStr, 10);
  const discount = parseInt(discountStr, 10);
  const cashValid = !isNaN(cash) && cash >= 0;
  const upiValid = !isNaN(upi) && upi >= 0;
  const discountValid =
    discountStr === "" || (!isNaN(discount) && discount >= 0);
  const cashN = cashValid ? cash : 0;
  const upiN = upiValid ? upi : 0;
  const discountN = discountStr === "" || isNaN(discount) ? 0 : discount;
  const sum = cashN + upiN + discountN;
  const canSubmit =
    cashValid &&
    upiValid &&
    discountValid &&
    sum === venueTotal &&
    cashN + upiN > 0 &&
    (cashN !== initialCash ||
      upiN !== initialUpi ||
      discountN !== initialDiscount);

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-zinc-700 bg-zinc-900/60 p-2.5">
      <p className="text-[11px] font-medium text-zinc-300">
        Re-attribute ₹{venueTotal.toLocaleString("en-IN")} collected at venue
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
            value={cashStr}
            onChange={(e) => setCashStr(e.target.value)}
            disabled={isPending}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs font-semibold text-white focus:border-emerald-500 focus:outline-none"
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
            value={upiStr}
            onChange={(e) => setUpiStr(e.target.value)}
            disabled={isPending}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs font-semibold text-white focus:border-emerald-500 focus:outline-none"
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
            value={discountStr}
            onChange={(e) => setDiscountStr(e.target.value)}
            disabled={isPending}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs font-semibold text-white focus:border-emerald-500 focus:outline-none"
          />
        </label>
      </div>
      <p
        className={`text-[11px] ${
          sum === venueTotal
            ? "text-emerald-400"
            : sum > venueTotal
            ? "text-red-400"
            : "text-zinc-500"
        }`}
      >
        Sum: ₹{sum.toLocaleString("en-IN")} / ₹{venueTotal.toLocaleString("en-IN")}
        {discountN > 0 ? (
          <span className="ml-2 text-zinc-500">
            (collected ₹{(cashN + upiN).toLocaleString("en-IN")})
          </span>
        ) : null}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setOpen(false)}
          disabled={isPending}
          className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-[11px] font-medium text-zinc-400 transition-colors hover:text-zinc-200 disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!canSubmit || isPending}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/20 px-3 py-1.5 text-[11px] font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3 w-3" />
          )}
          Save
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
