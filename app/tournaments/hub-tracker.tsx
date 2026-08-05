"use client";

import { useEffect } from "react";
import { trackTournamentHubView } from "@/lib/analytics";

/**
 * Fires the top-of-funnel `tournament_hub_view` event. The hub page is a
 * server component, so the event needs this one-line client island —
 * without it the web tournaments funnel had no entry point in GA4 while
 * the app's did.
 */
export function TournamentHubTracker() {
  useEffect(() => {
    trackTournamentHubView();
  }, []);
  return null;
}
