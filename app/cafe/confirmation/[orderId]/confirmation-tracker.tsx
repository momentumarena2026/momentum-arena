"use client";

import { useEffect } from "react";
import { trackCafeOrderConfirmationView } from "@/lib/analytics";

export function CafeConfirmationTracker({ orderId }: { orderId: string }) {
  useEffect(() => {
    trackCafeOrderConfirmationView(orderId);
  }, [orderId]);

  return null;
}
