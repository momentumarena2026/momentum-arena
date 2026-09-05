/**
 * One place that turns a URL into a screen.
 *
 * Promo banners and push notifications both let an admin type a
 * destination, and both have to land the customer in the same place —
 * so they share this rather than each carrying a list that drifts. A
 * link that works on a banner works on a push, by construction.
 *
 * Anything unrecognised opens in the browser rather than failing
 * silently: an admin typing a real website URL means it, and refusing
 * would be worse than leaving the app.
 */
import { Linking } from "react-native";
import { env } from "../config/env";

export type NavLike = { navigate: (name: string, params?: object) => void };

const SPORT_BY_SLUG: Record<string, string> = {
  cricket: "CRICKET",
  football: "FOOTBALL",
  pickleball: "PICKLEBALL",
};

export function resolveDeepLink(nav: NavLike, linkUrl: string) {
  let path = linkUrl;
  try {
    if (/^https?:\/\//.test(linkUrl)) path = new URL(linkUrl).pathname;
  } catch {
    path = linkUrl;
  }

  const sportMatch = path.match(/^\/book\/(cricket|football|pickleball)/);
  if (sportMatch) {
    nav.navigate("Main", {
      screen: "Sports",
      params: {
        screen: "BookCourt",
        params: { sport: SPORT_BY_SLUG[sportMatch[1]] },
      },
    });
    return;
  }
  if (path.startsWith("/book")) {
    nav.navigate("Main", { screen: "Sports", params: { screen: "BookSport" } });
    return;
  }
  if (path.startsWith("/cafe")) {
    nav.navigate("Main", { screen: "Cafe" });
    return;
  }
  if (path.startsWith("/shop")) {
    nav.navigate("Main", { screen: "Shop" });
    return;
  }
  if (path.startsWith("/passes") || path.startsWith("/my-passes")) {
    nav.navigate("Main", { screen: "Passes" });
    return;
  }
  if (path.startsWith("/coupons")) {
    nav.navigate("Main", { screen: "Account", params: { screen: "Coupons" } });
    return;
  }
  // Tournaments and camps live in the app too — without these a banner
  // pointing at them dropped the user into a mobile browser mid-session,
  // losing the native back stack and their sign-in.
  const tournamentMatch = path.match(/^\/tournaments\/([^/?#]+)/);
  if (tournamentMatch) {
    nav.navigate("Main", {
      // Home stack, not Account: a banner tapped on Home should back out
      // to Home. `initial: false` keeps HomeMain underneath so it does.
      screen: "Home",
      params: {
        screen: "TournamentDetail",
        params: { slug: decodeURIComponent(tournamentMatch[1]) },
        initial: false,
      },
    });
    return;
  }
  if (path.startsWith("/tournaments")) {
    nav.navigate("Main", {
      screen: "Home",
      params: { screen: "TournamentsList" },
    });
    return;
  }
  // Camps had no branch at all, so a banner pointing at one fell through
  // to the browser below — dropping the customer out of the app
  // mid-session and losing the native back stack and their sign-in. The
  // exact failure the tournament branches above were added to prevent.
  const campMatch = path.match(/^\/camps\/([^/?#]+)/);
  if (campMatch) {
    nav.navigate("Main", {
      // Home stack, not the tab: a banner tapped on Home should back out
      // to Home. `initial: false` keeps HomeMain underneath so it does.
      screen: "Home",
      params: {
        screen: "Camps",
        params: { slug: decodeURIComponent(campMatch[1]) },
        initial: false,
      },
    });
    return;
  }
  if (path.startsWith("/camps")) {
    nav.navigate("Main", { screen: "Home", params: { screen: "Camps" } });
    return;
  }
  // Unrecognised → browser (absolutise site-relative paths).
  const url = /^https?:\/\//.test(linkUrl) ? linkUrl : `${env.apiUrl}${linkUrl}`;
  Linking.openURL(url).catch(() => {});
}