"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markRemainderCollected } from "@/actions/admin-booking";
import { CheckCircle2, Loader2, Banknote, QrCode } from "lucide-react";

type CollectMethod = "CASH" | "UPI_QR";

/**
 * Two-step interaction on the amber partial-payment block of the admin
 * booking detail page:
 *   1. Click "Mark collected at venue" → show method picker (Cash / UPI QR)
 *   2. Pick a method → confirms + writes via markRemainderCollected
 *
 * On success, the parent page's router.refresh() is called so the block
 * flips to the emerald "Paid in Full" state and the list/KPI drop the
 * venue-due figure.
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
  const [picking, setPicking] = useState(false);

  function openPicker() {
    if (isPending) return;
    setError(null);
    setPicking(true);
  }

  function handleCollect(method: CollectMethod) {
    setError(null);
    startTransition(async () => {
      const result = await markRemainderCollected(bookingId, method);
      if (result.success) {
        router.refresh();
      } else {
        setError(result.error || "Failed to record collection");
      }
    });
  }

  if (remainingAmount <= 0) return null;

  if (!picking) {
    return (
      <div className="mt-2 space-y-2">
        <button
          onClick={openPicker}
          disabled={isPending}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/20 px-3 py-2 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/30 disabled:opacity-60"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Mark {formattedRemaining} collected at venue
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <p className="text-[11px] font-medium text-amber-200">
        Collected {formattedRemaining} via:
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => handleCollect("CASH")}
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
          onClick={() => handleCollect("UPI_QR")}
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
      {!isPending && (
        <button
          onClick={() => setPicking(false)}
          className="block w-full text-center text-[11px] text-zinc-500 hover:text-zinc-300"
        >
          Cancel
        </button>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
