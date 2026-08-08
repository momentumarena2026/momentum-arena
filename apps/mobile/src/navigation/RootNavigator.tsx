import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import {
  NavigationContainer,
  DarkTheme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "../providers/AuthProvider";
import { linking } from "./linking";
import {
  installForegroundMessageHandler,
  installPushTapHandlers,
  type ForegroundPush,
  type PushTapPayload,
} from "../lib/push";
import {
  trackPageView,
  trackWaitlistNotificationTapped,
} from "../lib/analytics";
import { OfflineBanner } from "../components/OfflineBanner";
import { NavLoader } from "../components/NavLoader";
import { InAppNotificationBanner } from "../components/InAppNotificationBanner";
import { colors } from "../theme";
import { MainNavigator } from "./MainNavigator";
import { PhoneScreen } from "../screens/auth/PhoneScreen";
import { OtpScreen } from "../screens/auth/OtpScreen";
import { AdminLoginScreen } from "../screens/admin/AdminLoginScreen";
import { AdminNavigator } from "./AdminNavigator";
import { adminTokenStorage } from "../lib/storage";
import { useAdminAuth } from "../providers/AdminAuthProvider";
import { ChatScreen } from "../screens/chat/ChatScreen";
import type { RootStackParamList } from "./types";
import { navigationRef } from "./navigationRef";
import { stackHeaderOptions } from "./headerOptions";

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.card,
    text: colors.foreground,
    border: colors.border,
    primary: colors.primary,
    notification: colors.primary,
  },
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { state } = useAuth();
  const { state: adminState } = useAdminAuth();

  /**
   * Land straight in admin on a phone that has an admin session.
   *
   * Staff were reaching admin through a 5-tap easter egg on the account
   * screen, every single launch. A device only holds an admin token if an
   * admin signed in on it, and admin login requires the device to be
   * trusted — so the token's presence already means "this phone runs
   * admin", with no trust round-trip to make.
   *
   * The read is a local Keychain lookup, so it rides the auth-restore
   * spinner that already gates boot rather than adding a stall. Token
   * validation still happens in AdminAuthProvider, but behind an
   * already-rendered screen instead of in front of it.
   *
   * A customer's phone has no token and is completely unaffected — the
   * easter egg stays the only way in.
   */
  const [landOnAdmin, setLandOnAdmin] = useState<boolean | null>(null);
  // Whether THIS launch auto-landed, so the fallback below only fires for
  // an automatic landing and never yanks an admin who navigated in by hand.
  const autoLandedRef = useRef(false);
  // Readiness has to be STATE, not an isReady() call inside the effect:
  // the effect's other deps settle before the container mounts, so an
  // early return on isReady() was a dead end that never retried.
  const [navReady, setNavReady] = useState(false);

  useEffect(() => {
    let alive = true;
    adminTokenStorage
      .read()
      .then((token) => {
        if (!alive) return;
        autoLandedRef.current = !!token;
        setLandOnAdmin(!!token);
      })
      // A Keychain failure must not brick the launch — fall back to the
      // customer app, which is what an unconfigured phone gets anyway.
      .catch(() => {
        if (alive) setLandOnAdmin(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // The token was present but the server rejected it (revoked admin,
  // deleted user, expired session). AdminAuthProvider has already cleared
  // the Keychain slot; drop quietly to the customer app rather than
  // stranding the user on an admin shell with no admin behind it.
  useEffect(() => {
    // Depends on BOTH signals, not just the status. With no usable token
    // adminAuth resolves to signedOut immediately — before the Keychain
    // read finishes — so watching status alone meant this ran once, too
    // early, and never again: the app landed in admin and stayed there
    // showing "Not signed in as admin".
    if (!navReady || !landOnAdmin || adminState.status !== "signedOut") return;
    autoLandedRef.current = false;
    setLandOnAdmin(false);
    navigationRef.reset({
      index: 0,
      routes: [{ name: "Main", params: { screen: "Home" } }],
    });
  }, [adminState.status, landOnAdmin, navReady]);
  // navigationRef is module-level (see ./navigationRef) rather than from
  // useNavigationContainerRef, so screens nested deep inside another
  // navigator can reach root routes explicitly instead of relying on the
  // navigate action bubbling up — which fails as a dead tap when it doesn't.

  const [banner, setBanner] = useState<(ForegroundPush & { id: number }) | null>(
    null,
  );
  const bannerId = useRef(0);

  // Shared push routing — used by both a notification tap and a tap on
  // the in-app foreground banner.
  const dispatchPushTap = useCallback(
    (payload: PushTapPayload) => {
      switch (payload.kind) {
        case "booking_confirmed":
        case "booking_reminder_24h":
        case "booking_reminder_2h":
        case "booking_reminder_1h":
        case "booking_cancelled":
        case "payment_verified":
        case "refund_processed":
          if (payload.bookingId) {
            navigationRef.navigate("Main", {
              screen: "Account",
              params: {
                screen: "BookingDetail",
                params: { bookingId: payload.bookingId },
                initial: false,
              },
            });
          }
          break;
        case "cafe_order_status": {
          // Land on the cafe order detail screen under AccountStack
          // when the push payload carries an orderId; otherwise
          // fall back to the cafe tab. Kitchen status-flip
          // notifications attach `cafeOrderId` on the push data.
          const orderId = payload.cafeOrderId;
          if (orderId) {
            navigationRef.navigate("Main", {
              screen: "Account",
              params: {
                screen: "CafeOrderDetail",
                params: { orderId },
                // Without this the Account tab is left showing only this
                // order, with no way back to the account screen.
                initial: false,
              },
            });
          } else {
            navigationRef.navigate("Main", {
              screen: "Cafe",
              params: { screen: "CafeMenu" },
            });
          }
          break;
        }
        case "rewards_earned":
          // Tap on a "you earned N pts" notification → land on the
          // Momentum Points screen (under Account tab). Account stack
          // already mounts RewardsScreen as a child.
          navigationRef.navigate("Main", {
            screen: "Account",
            params: {
              screen: "Rewards",
              initial: false,
            },
          });
          break;
        case "in_app":
          // In-app notification mirror — land on My Notifications.
          navigationRef.navigate("Main", {
            screen: "Account",
            params: {
              screen: "Notifications",
              initial: false,
            },
          });
          break;
        case "slot_available":
          // Drop the user into their waitlist screen so they see EVERY
          // entry that's been notified (a single freeing event can
          // unblock several entries at once when the user's range
          // covers multiple hours). They tap "Book now" from there.
          trackWaitlistNotificationTapped(payload.raw?.waitlistId);
          navigationRef.navigate("Main", {
            screen: "Account",
            params: {
              screen: "Waitlist",
              initial: false,
            },
          });
          break;
        case "open_screen": {
          // Admin broadcast with a chosen destination tab (data.screen).
          switch (payload.raw.screen) {
            case "book":
              navigationRef.navigate("Main", {
                screen: "Sports",
                params: { screen: "BookSport" },
              });
              break;
            case "cafe":
              navigationRef.navigate("Main", {
                screen: "Cafe",
                params: { screen: "CafeMenu" },
              });
              break;
            case "shop":
              navigationRef.navigate("Main", {
                screen: "Shop",
                params: { screen: "ShopHome" },
              });
              break;
            case "rewards":
              navigationRef.navigate("Main", {
                screen: "Account",
                params: { screen: "Rewards", initial: false },
              });
              break;
            default:
              navigationRef.navigate("Main", { screen: "Home" });
              break;
          }
          break;
        }
        // Admin-bound payloads land here when an admin device taps a
        // notification. We jump straight into the AdminShell tabs —
        // pending routes to the unconfirmed queue (where the floor
        // staffer needs to verify the screenshot/cash); confirmed +
        // cancelled route to the booking detail. No fallback for
        // missing bookingId because the server always includes it
        // for admin pushes; if it ever doesn't, opening the app at
        // the bookings tab is still useful.
        case "admin_pending_booking":
          navigationRef.navigate("AdminShell", {
            screen: "AdminBookings",
            // Same reason as the detail below — the queue needs the list
            // beneath it or Back and the Bookings tab both dead-end on it.
            params: { screen: "AdminUnconfirmedBookingsList", initial: false },
          });
          break;
        case "admin_booking_confirmed":
        case "admin_booking_cancelled":
          if (payload.bookingId) {
            // `initial: false` is load-bearing: without it the Bookings
            // stack initialises with the detail as its ONLY route, and the
            // admin is stranded. Back has nothing to pop, so the tab
            // navigator handles it and drops them on the first tab; and the
            // Bookings tab itself stays parked on that one booking, so
            // tapping Bookings reopens the same detail forever. There is no
            // route to the list from anywhere.
            //
            // Two chained navigates were tried here and cannot work: while
            // the Bookings stack is still unmounted both actions resolve
            // against the *tab* navigator, so the second just overwrites the
            // first's nested state and the list never lands underneath.
            navigationRef.navigate("AdminShell", {
              screen: "AdminBookings",
              params: {
                screen: "AdminBookingDetail",
                params: { bookingId: payload.bookingId },
                initial: false,
              },
            });
          } else {
            navigationRef.navigate("AdminShell", {
              screen: "AdminBookings",
              params: { screen: "AdminBookingsList" },
            });
          }
          break;
      }
    },
    [navigationRef],
  );

  // Tap routing — cold-start (`getInitialNotification`) + background-tap
  // (`onNotificationOpenedApp`). Side-effect-free, so once on mount is fine.
  useEffect(() => {
    const unsub = installPushTapHandlers((payload) => {
      // Cold-start payload may arrive before the container has mounted.
      if (!navigationRef.isReady()) {
        const id = setInterval(() => {
          if (!navigationRef.isReady()) return;
          clearInterval(id);
          dispatchPushTap(payload);
        }, 100);
        setTimeout(() => clearInterval(id), 5000);
        return;
      }
      dispatchPushTap(payload);
    });
    return unsub;
  }, [navigationRef, dispatchPushTap]);

  // Foreground messages — iOS shows no system banner while the app is
  // open, so surface them as an in-app banner. Keyed by an incrementing
  // id so each push remounts the banner (fresh slide-in + auto-dismiss).
  useEffect(() => {
    return installForegroundMessageHandler((msg) => {
      bannerId.current += 1;
      setBanner({ ...msg, id: bannerId.current });
    });
  }, []);

  if (state.status === "loading" || landOnAdmin === null) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <>
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      // Universal Links / App Links. Without this an incoming
      // momentumarena.com link opens the app on Home rather than on the
      // page the user actually tapped.
      linking={linking}
      // Stamp a page_view event on every screen transition. Fired as
      // `route_name` (not URL — there's no URL on mobile) so the
      // dashboard can group by screen the same way the web tracker
      // groups by pathname.
      onReady={() => {
        setNavReady(true);
        // Push admin ON TOP of Main rather than replacing it as the
        // initial route. Two reasons, both learned the hard way:
        // navigationRef isn't ready until this fires, so a reset issued
        // from an effect silently does nothing; and AdminNavigator hides
        // every tab when there's no admin, so landing straight there with
        // a stale token renders a blank screen with no way out. With Main
        // underneath there is always somewhere safe to fall back to.
        if (landOnAdmin) {
          // Same stack the admin login builds on success: Main at the
          // bottom, AdminShell on top. Keeping Main underneath is what
          // makes the fallback below possible and gives the header's
          // "Customer" button somewhere to land.
          navigationRef.reset({
            index: 1,
            routes: [
              { name: "Main", params: { screen: "Home" } },
              { name: "AdminShell" },
            ],
          });
        }
        const route = navigationRef.getCurrentRoute()?.name;
        if (route) trackPageView(route);
      }}
      onStateChange={() => {
        const route = navigationRef.getCurrentRoute()?.name;
        if (route) trackPageView(route);
      }}
    >
      <Stack.Navigator>
        <Stack.Screen
          name="Main"
          component={MainNavigator}
          options={{ headerShown: false }}
        />
        <Stack.Group
          screenOptions={(p) => ({
            ...stackHeaderOptions(p),
            presentation: "modal",
          })}
        >
          <Stack.Screen
            name="Phone"
            component={PhoneScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Otp"
            component={OtpScreen}
            options={{ title: "" }}
          />
          <Stack.Screen
            name="AdminLogin"
            component={AdminLoginScreen}
            options={{ headerShown: false }}
          />
        </Stack.Group>
        {/* Admin shell — full-screen, hides the customer tab bar
            entirely while the staffer is in admin mode. They come
            back via the in-shell "Customer view" button or sign-out. */}
        <Stack.Screen
          name="AdminShell"
          component={AdminNavigator}
          options={{
            headerShown: false,
            presentation: "fullScreenModal",
            animation: "slide_from_right",
          }}
        />
        {/* Arena Assistant — was a tab, now a presented stack. Pops
            from the Account screen tile and back-stacks to wherever
            it was opened from. */}
        <Stack.Screen
          name="Chat"
          component={ChatScreen}
          options={{
            title: "Arena Assistant",
            presentation: "card",
            animation: "slide_from_right",
            headerStyle: { backgroundColor: colors.background },
            headerTitleStyle: { color: colors.foreground },
            headerTintColor: colors.primary,
            headerShadowVisible: false,
          }}
        />
        {/* Tournament scoring used to live here as an auth-free,
            code-only route. It is now admin-only and reached from the
            admin tournaments screen (AdminScorerConsole). A volunteer
            without an admin account uses the web /score/[code] console. */}
      </Stack.Navigator>
    </NavigationContainer>
    {/* Top progress bar — overlay sibling of the navigator so it
        sits above every screen, customer + admin alike. Driven by
        TanStack Query in-flight state. */}
    <NavLoader />
    {/* Connectivity bar — overlay sibling of the navigator so it shows
        on every screen, customer and admin alike. */}
    <OfflineBanner />
    {banner && (
      <InAppNotificationBanner
        key={banner.id}
        title={banner.title}
        body={banner.body}
        onPress={() => {
          if (banner.tap) dispatchPushTap(banner.tap);
        }}
        onDismiss={() => setBanner(null)}
      />
    )}
    </>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
});
