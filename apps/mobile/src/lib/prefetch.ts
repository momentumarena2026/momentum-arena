import { queryClient } from "./queryClient";
import { fetchTournamentHub } from "./tournaments";
import { fetchCampsHub } from "./camps";
import { bookingApi } from "./booking";
import { bookingsApi } from "./bookings";
import { notificationsApi } from "./user-notifications";
import { promoBannersApi } from "./promo-banners";

/**
 * Warm the landing screen's data DURING the splash.
 *
 * The splash holds for ~2.3s before RootNavigator mounts, and nothing
 * below it exists until then — so every home-screen query used to start
 * only *after* the animation finished. The network time was stacked on
 * top of the animation time instead of hiding underneath it, which is
 * most of the 4-5s a cold start took to show content.
 *
 * Firing the same queries here, on app mount, means they run in parallel
 * with the animation and are usually resolved by the time the navigator
 * appears. HomeScreen's useQuery calls then hit a warm cache instead of
 * an empty one.
 *
 * The query keys and fns below MUST stay identical to the ones in
 * HomeScreen / PromoBannerSlot — a mismatched key silently prefetches
 * into a cache entry nobody reads, which looks like nothing happening.
 */

/** staleTime matches the screens', so a prefetch counts as fresh and the
 *  screen doesn't immediately refetch what we just fetched. */
const FIVE_MIN = 5 * 60 * 1000;

/** Public data — no token needed, so this can start at the very first
 *  frame without waiting for the auth bootstrap. */
export function prefetchPublicHomeData(): void {
  const warm = (key: unknown[], fn: () => Promise<unknown>, staleTime: number) => {
    // Never let a prefetch failure surface: this is an optimisation, and
    // the screen's own query will retry and render the error properly.
    void queryClient.prefetchQuery({ queryKey: key, queryFn: fn, staleTime }).catch(() => {});
  };

  warm(["tournaments"], fetchTournamentHub, FIVE_MIN);
  warm(["camps-hub"], fetchCampsHub, FIVE_MIN);
  warm(["sport-promo", "PICKLEBALL"], () => bookingApi.sportPromo("PICKLEBALL"), FIVE_MIN);
  // Both banner slots the home screen renders.
  warm(["promo-banners", "HOME_TOP", null], () => promoBannersApi.forScreen("HOME_TOP"), FIVE_MIN);
  warm(["promo-banners", "HOME_PROMO", null], () => promoBannersApi.forScreen("HOME_PROMO"), FIVE_MIN);
}

/** Signed-in data. Called once the auth bootstrap has a session — still
 *  well inside the splash window on a normal launch. */
export function prefetchSignedInHomeData(): void {
  void queryClient
    .prefetchQuery({ queryKey: ["dashboard"], queryFn: bookingsApi.dashboard })
    .catch(() => {});
  void queryClient
    .prefetchQuery({
      queryKey: ["notifications", "unread"],
      queryFn: () => notificationsApi.list(),
      staleTime: 60_000,
    })
    .catch(() => {});
}
