import type { LinkingOptions } from "@react-navigation/native";
import type { RootStackParamList } from "./types";

/**
 * URL → screen map for Universal Links / App Links.
 *
 * Without this an incoming momentumarena.com link opens the app on Home,
 * which is worse than the browser: the user tapped a specific tournament
 * and got a generic landing screen. Each path below lands on the screen
 * that shows the same thing the web page would have.
 *
 * Paths mirror the website's routes exactly — they ARE the website's
 * routes; iOS/Android hand us the tapped URL verbatim. If a web route
 * moves, this map has to move with it or that link silently degrades to
 * "app opens somewhere else".
 *
 * Only routes with a real app equivalent are listed. Anything unlisted
 * (policies, admin, blog) falls through to Home — for those, the
 * paths: ["*"] in the association file could be narrowed later so the
 * browser keeps them instead.
 */
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [
    "https://momentumarena.com",
    "https://www.momentumarena.com",
    // Custom scheme, for pushes and QR codes that don't go via the web.
    "momentumarena://",
  ],
  config: {
    screens: {
      Main: {
        screens: {
          Home: {
            screens: {
              HomeMain: "",
              TournamentsList: "tournaments",
              TournamentDetail: "tournaments/:slug",
              // The web tournament sub-pages (table, bracket, matches) all
              // live inside the app's detail screen, so they resolve there
              // rather than 404-ing into Home.
              Camps: "camps",
            },
          },
          Sports: {
            screens: {
              BookSport: "book",
              BookCourt: "book/:sport",
            },
          },
          Passes: {
            screens: {
              MyPasses: "my-passes",
              PassesStore: "passes",
              PassDetail: "passes/:passId",
            },
          },
          Cafe: {
            screens: {
              CafeMenu: "cafe",
              CafeOrderDetail: "cafe/orders/:orderId",
            },
          },
          Shop: {
            screens: {
              ShopHome: "shop",
              ShopOrderDetail: "shop/orders/:orderId",
            },
          },
          Account: {
            screens: {
              AccountHome: "account",
              BookingsList: "bookings",
              BookingDetail: "bookings/:bookingId",
              Notifications: "notifications",
              Coupons: "coupons",
              Rewards: "rewards",
              MatchScore: "match/:code",
            },
          },
        },
      },
    },
  },
};
