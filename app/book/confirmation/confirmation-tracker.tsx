"use client";

import { useEffect } from "react";
import { trackBookingConfirmedView } from "@/lib/analytics";

export function ConfirmationTracker({
  bookingId,
  status,
}: {
  bookingId: string;
  status: string;
}) {
  useEffect(() => {
    trackBookingConfirmedView(bookingId, status);
  }, [bookingId, status]);

  return null;
}
