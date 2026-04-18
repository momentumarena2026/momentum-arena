"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markRemainderCollected } from "@/actions/admin-booking";
import { CheckCircle2, Loader2 } from "lucide-react";

/**
 * Button that lives inside the amber partial-payment block on the admin
 * booking detail page. When pressed it records that the admin collected
 * the outstanding cash from the customer on arrival, which zeroes out
 * Payment.remainingAmount and drops the booking from the "Cash Due at
 * Venue" KPI on the list page.
 */
export function MarkCollectedButton({
  bookingId,
  remainingAmount,
  formattedRemaining,
}: {
  bookingId: string;
  remainingAmount: number;
  formattedRemaining: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function handleClick() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await markRemainderCollected(bookingId);
      if (result.success) {
        router.refresh();
      } else {
        setError(result.error || "Failed to record collection");
        setConfirming(false);
      }
    });
  }

  if (remainingAmount <= 0) return null;

  return (
    <div className="mt-2 space-y-2">
      <button
        onClick={handleClick}
        disabled={isPending}
        className={`flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-60 ${
          confirming
            ? "bg-emerald-600 text-white hover:bg-emerald-500"
            : "bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 border border-amber-500/40"
        }`}
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5" />
        )}
        {isPending
          ? "Recording..."
          : confirming
            ? `Confirm: ${formattedRemaining} collected`
            : `Mark ${formattedRemaining} collected at venue`}
      </button>
      {confirming && !isPending && (
        <button
          onClick={() => setConfirming(false)}
          className="block text-[11px] text-zinc-500 hover:text-zinc-300 w-full text-center"
        >
          Cancel
        </button>
      )}
      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}
