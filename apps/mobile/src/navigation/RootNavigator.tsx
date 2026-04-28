import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import {
  NavigationContainer,
  DarkTheme,
  useNavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "../providers/AuthProvider";
import { installPushTapHandlers } from "../lib/push";
import { colors } from "../theme";
import { MainNavigator } from "./MainNavigator";
import { PhoneScreen } from "../screens/auth/PhoneScreen";
import { OtpScreen } from "../screens/auth/OtpScreen";
import { AdminLoginScreen } from "../screens/admin/AdminLoginScreen";
import { AdminNavigator } from "./AdminNavigator";
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

  // Push-tap routing. Wires both cold-start (`getInitialNotification`)
  // and background-tap (`onNotificationOpenedApp`). Lives here so it
  // has direct access to the navigation ref; `installPushTapHandlers`
  // is otherwise side-effect-free, so running it once on mount is fine.
  useEffect(() => {
    const unsub = installPushTapHandlers((payload) => {
      // Wait until navigation is ready — cold-start payload may arrive
      // before the container has mounted.
      if (!navigationRef.isReady()) {
        const id = setInterval(() => {
          if (!navigationRef.isReady()) return;
          clearInterval(id);
          dispatchPushTap(payload);
        }, 100);
        // Defensive cap: stop polling after 5s if navigation never
        // becomes ready (bug somewhere). Otherwise this would leak.
        setTimeout(() => clearInterval(id), 5000);
        return;
      }
      dispatchPushTap(payload);
    });
    return unsub;

    function dispatchPushTap(payload: Parameters<Parameters<typeof installPushTapHandlers>[0]>[0]) {
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
        case "cafe_order_status":
          // No CafeOrderDetail screen yet — drop into the cafe tab.
          navigationRef.navigate("Main", { screen: "Cafe" });
          break;
      }
    }
  }, [navigationRef]);

  if (state.status === "loading") {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme}>
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
      </Stack.Navigator>
    </NavigationContainer>
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
