import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import {
  CalendarCheck,
  Coffee,
  IndianRupee,
  LogOut,
  ShieldCheck,
  UserSquare2,
} from "lucide-react-native";
import { Text } from "../components/ui/Text";
import { colors, spacing } from "../theme";
import { useAdminAuth } from "../providers/AdminAuthProvider";
import { AdminBookingsListScreen } from "../screens/admin/AdminBookingsListScreen";
import { AdminUnconfirmedBookingsListScreen } from "../screens/admin/AdminUnconfirmedBookingsListScreen";
import { AdminBookingDetailScreen } from "../screens/admin/AdminBookingDetailScreen";
import { AdminEditSlotsScreen } from "../screens/admin/AdminEditSlotsScreen";
import { AdminEditBookingScreen } from "../screens/admin/AdminEditBookingScreen";
import { AdminPlaceholderScreen } from "../screens/admin/AdminPlaceholderScreen";
import type {
  AdminBookingsStackParamList,
  AdminTabsParamList,
  RootStackParamList,
} from "./types";

const BookingsStack = createNativeStackNavigator<AdminBookingsStackParamList>();
const Tabs = createBottomTabNavigator<AdminTabsParamList>();

function AdminBookingsStack() {
  return (
    <BookingsStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTitleStyle: { color: colors.foreground, fontWeight: "600" },
        headerTintColor: colors.primary,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <BookingsStack.Screen
        name="AdminBookingsList"
        component={AdminBookingsListScreen}
        options={{ headerShown: false }}
      />
      <BookingsStack.Screen
        name="AdminUnconfirmedBookingsList"
        component={AdminUnconfirmedBookingsListScreen}
        options={{ title: "Unconfirmed" }}
      />
      <BookingsStack.Screen
        name="AdminBookingDetail"
        component={AdminBookingDetailScreen}
        options={{ title: "Booking" }}
      />
      <BookingsStack.Screen
        name="AdminEditSlots"
        component={AdminEditSlotsScreen}
        options={{ title: "Edit Slots" }}
      />
      <BookingsStack.Screen
        name="AdminEditBooking"
        component={AdminEditBookingScreen}
        options={{ title: "Edit Booking" }}
      />
    </BookingsStack.Navigator>
  );
}

/**
 * Admin shell. Reached either from the AdminLogin success handler
 * or by 5-tapping the Account-screen version footer when an admin
 * session already exists in Keychain.
 *
 * Three bottom tabs mirror the seven web admin sections the user
 * cares about, grouped by floor-staff workflow:
 *   - Bookings: list + detail + filters + actions (covers 1–5).
 *   - Cafe: menu + orders kanban (placeholder for now).
 *   - Expenses: list + analytics (placeholder for now).
 *
 * The header on every tab carries the same two utility buttons:
 *   - "Customer view" → switches to the customer Main stack without
 *     signing the admin out, so a staffer can quickly check what a
 *     customer sees and come back via the 5-tap.
 *   - Sign-out → clears the admin token and returns to customer view.
 */
export function AdminNavigator() {
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        header: () => <AdminHeader title={titleFor(route.name)} />,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 72,
          paddingTop: 6,
          paddingBottom: 12,
        },
        tabBarActiveTintColor: colors.yellow400,
        tabBarInactiveTintColor: colors.subtleForeground,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarIcon: ({ color, size }) => {
          const props = { color, size: size ?? 20, strokeWidth: 2 } as const;
          switch (route.name) {
            case "AdminBookings":
              return <CalendarCheck {...props} />;
            case "AdminCafe":
              return <Coffee {...props} />;
            case "AdminExpenses":
              return <IndianRupee {...props} />;
          }
        },
      })}
    >
      <Tabs.Screen
        name="AdminBookings"
        component={AdminBookingsStack}
        options={{ tabBarLabel: "Bookings" }}
      />
      <Tabs.Screen
        name="AdminCafe"
        component={AdminPlaceholderScreen}
        options={{ tabBarLabel: "Cafe" }}
      />
      <Tabs.Screen
        name="AdminExpenses"
        component={AdminPlaceholderScreen}
        options={{ tabBarLabel: "Expenses" }}
      />
    </Tabs.Navigator>
  );
}

function titleFor(name: keyof AdminTabsParamList): string {
  switch (name) {
    case "AdminBookings":
      return "Bookings";
    case "AdminCafe":
      return "Cafe";
    case "AdminExpenses":
      return "Expenses";
  }
}

function AdminHeader({ title }: { title: string }) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { state, signOut } = useAdminAuth();
  const insets = useSafeAreaInsets();
  const adminName =
    state.status === "signedIn" ? state.admin.username : null;

  return (
    <View
      style={[
        styles.header,
        // Add the device's status-bar / notch inset so the header
        // sits below the carrier/clock row instead of overlapping it.
        // Tab navigators don't auto-pad their custom `header` like
        // native-stack does, so we apply it manually.
        { paddingTop: insets.top + spacing["3"] },
      ]}
    >
      <View style={styles.headerLeft}>
        <View style={styles.headerBadge}>
          <ShieldCheck size={16} color={colors.yellow400} />
        </View>
        <View>
          <Text variant="bodyStrong">{title}</Text>
          {adminName ? (
            <Text variant="tiny" color={colors.zinc500}>
              Admin · {adminName}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.headerActions}>
        <Pressable
          onPress={() => navigation.navigate("Main", { screen: "Home" })}
          hitSlop={8}
          style={({ pressed }) => [
            styles.headerBtn,
            pressed && { opacity: 0.6 },
          ]}
        >
          <UserSquare2 size={16} color={colors.zinc300} />
          <Text variant="tiny" color={colors.zinc300}>
            Customer
          </Text>
        </Pressable>
        <Pressable
          onPress={() =>
            void (async () => {
              await signOut();
              navigation.navigate("Main", { screen: "Home" });
            })()
          }
          hitSlop={8}
          style={({ pressed }) => [
            styles.headerBtn,
            pressed && { opacity: 0.6 },
          ]}
        >
          <LogOut size={16} color={colors.zinc300} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing["5"],
    // paddingTop is set inline to insets.top + spacing[3] to push the
    // header below the device's status bar / notch / dynamic island.
    paddingBottom: spacing["3"],
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2.5"],
  },
  headerBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(250, 204, 21, 0.30)",
    backgroundColor: "rgba(250, 204, 21, 0.10)",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
  },
  headerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
    paddingHorizontal: spacing["2.5"],
    paddingVertical: spacing["2"],
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
});
