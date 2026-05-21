"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { trackCafeOrderConfirmationView } from "@/lib/analytics";

export function CafeConfirmationTracker({ orderId }: { orderId: string }) {
  const router = useRouter();

  useEffect(() => {
    trackCafeOrderConfirmationView(orderId);

    // Re-fetch the server tree so the RewardsChip in the parent
    // layout reflects the updated balance after any points the
    // customer redeemed against this order. Cafe earn-points fire
    // later (when staff marks the order COMPLETED) — the customer
    // is unlikely to still be on this page then, but a delayed
    // second refresh handles the rare case of a fast prep / instant
    // hand-off without forcing a page reload. router.refresh is a
    // no-op if nothing changed.
    router.refresh();
    const t = setTimeout(() => router.refresh(), 1500);
    return () => clearTimeout(t);
  }, [orderId, router]);

  return null;
}
