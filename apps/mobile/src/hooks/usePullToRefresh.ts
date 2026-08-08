import { useCallback, useState } from "react";

/**
 * Pull-to-refresh state that only reacts to an actual pull.
 *
 * The obvious wiring — `refreshing={isRefetching}` from useQuery — is wrong
 * on any screen that also polls. React Query sets isRefetching for EVERY
 * background refetch, so a `refetchInterval` makes the spinner drop in and
 * out on every tick: the tournament screens flashed the loader every 10-12
 * seconds while sitting still.
 *
 * Live data should keep arriving silently. Only the gesture the customer
 * performed should produce a spinner, so track that separately and leave
 * the polling to update the content underneath without announcing itself.
 *
 *   const { refreshing, onRefresh } = usePullToRefresh(refetch);
 *   <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
 */
export function usePullToRefresh(refetch: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      // finally, not after await: a failed refetch must still clear the
      // spinner or it hangs at the top of the screen forever.
      setRefreshing(false);
    }
  }, [refetch]);

  return { refreshing, onRefresh };
}
