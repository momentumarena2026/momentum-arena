"use client";

import { useEffect } from "react";
import { trackRewardsView } from "@/lib/analytics";

/**
 * Fire-once tracker — drops a `rewards_view` analytics event on mount
 * so the Rewards funnel on /admin/analytics/funnels can measure
 * "user discovered the rewards surface". Rendered by the /rewards
 * server component near the top of the tree.
 */
export function TrackRewardsView({
  pointsAvailable,
}: {
  pointsAvailable: number;
}) {
  useEffect(() => {
    trackRewardsView(pointsAvailable);
    // Intentionally only fires once per mount — re-renders shouldn't
    // re-emit the discovery signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
