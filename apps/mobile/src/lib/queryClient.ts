import { AppState, type AppStateStatus } from "react-native";
import { QueryClient, focusManager } from "@tanstack/react-query";
import { hydrateQueryCache, persistQueryCache } from "./queryPersist";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Survives a trip to another app and back without refetching.
      // Cold starts are covered by the disk cache below.
      gcTime: 30 * 60_000,
      retry: (failureCount, error) => {
        // Don't retry 4xx from our API; they're deterministic.
        const status = (error as { status?: number } | null)?.status;
        if (typeof status === "number" && status >= 400 && status < 500) {
          return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});

// Seed from disk at module load — this runs before the first render, so
// the landing screen's first frame already has last session's data
// instead of skeletons. The entries keep their original timestamps, so
// react-query still refetches in the background.
hydrateQueryCache(queryClient);
persistQueryCache(queryClient);

/**
 * Tell react-query when the app comes back to the foreground.
 *
 * Without this, "focus" never happens in React Native — the concept is
 * a browser one — so a query that opts into `refetchOnWindowFocus` has
 * nothing to listen to. Queries that do NOT opt in are unaffected: the
 * global default below is still `false`, so resuming the app does not
 * suddenly refire 160 requests.
 *
 * Added because the Information Bar went stale and stayed stale. The
 * admin saved new copy, the website changed at once, and the app kept
 * showing the previous announcement — a cold start corrected it after
 * a background refetch, but merely resuming the app never did, because
 * nothing remounts the home screen and nothing told react-query the
 * app had been looked at again.
 */
AppState.addEventListener("change", (status: AppStateStatus) => {
  focusManager.setFocused(status === "active");
});
