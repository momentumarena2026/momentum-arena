"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cancelOrder } from "@/actions/shop-order";

/**
 * Customer-side cancel button for a PENDING order. Stock is
 * released atomically inside cancelOrder; the order moves to
 * CANCELLED and shows up that way on next render.
 */
export function CancelOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCancel() {
    if (!confirm("Cancel this order? Your cart will not be restored.")) return;
    startTransition(async () => {
      const res = await cancelOrder(orderId, "Cancelled by customer");
      if (!res.success) {
        setError(res.error ?? "Cancel failed");
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={handleCancel}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-300 hover:border-red-400 hover:bg-red-500/20 disabled:opacity-60"
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        Cancel order
      </button>
      {error ? (
        <p className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </>
  );
}
