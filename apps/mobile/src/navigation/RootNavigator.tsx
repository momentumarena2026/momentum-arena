import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import {
  NavigationContainer,
  DarkTheme,
  useNavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "../providers/AuthProvider";
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
import { NavLoader } from "../components/NavLoader";
import { InAppNotificationBanner } from "../components/InAppNotificationBanner";
import { colors } from "../theme";
import { MainNavigator } from "./MainNavigator";
import { PhoneScreen } from "../screens/auth/PhoneScreen";
import { OtpScreen } from "../screens/auth/OtpScreen";
import { AdminLoginScreen } from "../screens/admin/AdminLoginScreen";
import { AdminNavigator } from "./AdminNavigator";
import { ChatScreen } from "../screens/chat/ChatScreen";
import type { RootStackParamList } from "./types";

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
  const navigationRef = useNavigationContainerRef<RootStackParamList>();

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
            params: { screen: "AdminUnconfirmedBookingsList" },
          });
          break;
        case "admin_booking_confirmed":
        case "admin_booking_cancelled":
          if (payload.bookingId) {
            navigationRef.navigate("AdminShell", {
              screen: "AdminBookings",
              params: {
                screen: "AdminBookingDetail",
                params: { bookingId: payload.bookingId },
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

  if (state.status === "loading") {
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
      // Stamp a page_view event on every screen transition. Fired as
      // `route_name` (not URL — there's no URL on mobile) so the
      // dashboard can group by screen the same way the web tracker
      // groups by pathname.
      onReady={() => {
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
          screenOptions={{
            presentation: "modal",
            contentStyle: { backgroundColor: colors.background },
            headerStyle: { backgroundColor: colors.background },
            headerTitleStyle: { color: colors.foreground },
            headerTintColor: colors.primary,
            headerShadowVisible: false,
          }}
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
      </Stack.Navigator>
    </NavigationContainer>
    {/* Top progress bar — overlay sibling of the navigator so it
        sits above every screen, customer + admin alike. Driven by
        TanStack Query in-flight state. */}
    <NavLoader />
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
