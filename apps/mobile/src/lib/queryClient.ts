import { QueryClient } from "@tanstack/react-query";
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
