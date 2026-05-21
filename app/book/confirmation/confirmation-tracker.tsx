"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { trackBookingConfirmedView } from "@/lib/analytics";

export function ConfirmationTracker({
  bookingId,
  status,
}: {
  bookingId: string;
  status: string;
}) {
  const router = useRouter();

  useEffect(() => {
    trackBookingConfirmedView(bookingId, status);

    // Re-fetch the server tree so the RewardsChip in the parent
    // layout shows the updated balance. The booking transaction
    // (createBookingFromHold) commits any points-redemption in the
    // same atomic write, so an immediate refresh catches that. The
    // earn-points write fires from the Razorpay/PhonePe verify
    // route's `after()` block, which can land a beat AFTER the
    // browser navigates here — so a second refresh ~1.5s later
    // catches the freshly-credited points without the user having
    // to reload. router.refresh is a no-op if nothing changed, so
    // the double-fire is harmless.
    router.refresh();
    const t = setTimeout(() => router.refresh(), 1500);
    return () => clearTimeout(t);
  }, [bookingId, status, router]);

  return null;
}
