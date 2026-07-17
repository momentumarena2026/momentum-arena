import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import {
  BarChart3,
  CalendarCheck,
  CalendarRange,
  Coffee,
  LogOut,
  Menu,
  ShieldCheck,
  UserSquare2,
} from "lucide-react-native";
import { Text } from "../components/ui/Text";
import { colors, spacing } from "../theme";
import { useAdminAuth } from "../providers/AdminAuthProvider";
import { adminCan } from "../lib/admin-permissions";
import { AdminBookingsListScreen } from "../screens/admin/AdminBookingsListScreen";
import { AdminUnconfirmedBookingsListScreen } from "../screens/admin/AdminUnconfirmedBookingsListScreen";
import { AdminBookingDetailScreen } from "../screens/admin/AdminBookingDetailScreen";
import { AdminEditSlotsScreen } from "../screens/admin/AdminEditSlotsScreen";
import { AdminEditBookingScreen } from "../screens/admin/AdminEditBookingScreen";
import { AdminEditPaymentScreen } from "../screens/admin/AdminEditPaymentScreen";
import { AdminCreateBookingScreen } from "../screens/admin/AdminCreateBookingScreen";
import { AdminCheckinScreen } from "../screens/admin/AdminCheckinScreen";
import { AdminCalendarScreen } from "../screens/admin/AdminCalendarScreen";
import { AdminSlotBlocksScreen } from "../screens/admin/AdminSlotBlocksScreen";
import { AdminCafeOrdersScreen } from "../screens/admin/AdminCafeOrdersScreen";
import { AdminCafeMenuScreen } from "../screens/admin/AdminCafeMenuScreen";
import { AdminCafeCreateOrderScreen } from "../screens/admin/AdminCafeCreateOrderScreen";
import { AdminExpensesListScreen } from "../screens/admin/AdminExpensesListScreen";
import { AdminExpenseFormScreen } from "../screens/admin/AdminExpenseFormScreen";
import { AdminExpenseAnalyticsScreen } from "../screens/admin/AdminExpenseAnalyticsScreen";
import { AdminRewardsScreen } from "../screens/admin/AdminRewardsScreen";
import { AdminRewardsAnalyticsScreen } from "../screens/admin/AdminRewardsAnalyticsScreen";
import { AdminRewardsDistributeScreen } from "../screens/admin/AdminRewardsDistributeScreen";
import { AdminRewardsTransactionsScreen } from "../screens/admin/AdminRewardsTransactionsScreen";
import { AdminRewardsConfigScreen } from "../screens/admin/AdminRewardsConfigScreen";
import { AdminDashboardScreen } from "../screens/admin/AdminDashboardScreen";
import { AdminMoreScreen } from "../screens/admin/AdminMoreScreen";
import { AdminSportsScreen } from "../screens/admin/AdminSportsScreen";
import { AdminEquipmentScreen } from "../screens/admin/AdminEquipmentScreen";
import { AdminBowlingScreen } from "../screens/admin/AdminBowlingScreen";
import { AdminPricingScreen } from "../screens/admin/AdminPricingScreen";
import { AdminCouponsScreen } from "../screens/admin/AdminCouponsScreen";
import { AdminPassesScreen } from "../screens/admin/AdminPassesScreen";
import { AdminRainBannerScreen } from "../screens/admin/AdminRainBannerScreen";
import { AdminPromoBannersScreen } from "../screens/admin/AdminPromoBannersScreen";
import { AdminProductsScreen } from "../screens/admin/AdminProductsScreen";
import { AdminProductOrdersScreen } from "../screens/admin/AdminProductOrdersScreen";
import { AdminPosScreen } from "../screens/admin/AdminPosScreen";
import { AdminPushScreen } from "../screens/admin/AdminPushScreen";
import { AdminPushTemplatesScreen } from "../screens/admin/AdminPushTemplatesScreen";
import { AdminOtaScreen } from "../screens/admin/AdminOtaScreen";
import { AdminReleaseFlowScreen } from "../screens/admin/AdminReleaseFlowScreen";
import { AdminUsersScreen } from "../screens/admin/AdminUsersScreen";
import { AdminUserGroupsScreen } from "../screens/admin/AdminUserGroupsScreen";
import { AdminFaqsScreen } from "../screens/admin/AdminFaqsScreen";
import { AdminGeneratorScreen } from "../screens/admin/AdminGeneratorScreen";
import { AdminSportsAnalyticsScreen } from "../screens/admin/AdminSportsAnalyticsScreen";
import { AdminCafeAnalyticsScreen } from "../screens/admin/AdminCafeAnalyticsScreen";
import { AdminPushAnalyticsScreen } from "../screens/admin/AdminPushAnalyticsScreen";
import { AdminDemandScreen } from "../screens/admin/AdminDemandScreen";
import { AdminCohortsScreen } from "../screens/admin/AdminCohortsScreen";
import { AdminFunnelsScreen } from "../screens/admin/AdminFunnelsScreen";
import { AdminEventsScreen } from "../screens/admin/AdminEventsScreen";
import { AdminPaymentSettingsScreen } from "../screens/admin/AdminPaymentSettingsScreen";
import { AdminRazorpayScreen } from "../screens/admin/AdminRazorpayScreen";
import { AdminPhonePeScreen } from "../screens/admin/AdminPhonePeScreen";
import { AdminAdminUsersScreen } from "../screens/admin/AdminAdminUsersScreen";
import { AdminTrustedDevicesScreen } from "../screens/admin/AdminTrustedDevicesScreen";
import { AdminProfileScreen } from "../screens/admin/AdminProfileScreen";
import { AdminRecoveryScreen } from "../screens/admin/AdminRecoveryScreen";
import { AdminRecurringConfigScreen } from "../screens/admin/AdminRecurringConfigScreen";
import { AdminUtrVerifyScreen } from "../screens/admin/AdminUtrVerifyScreen";
import { AdminDiscountsScreen } from "../screens/admin/AdminDiscountsScreen";
import { AdminReportsScreen } from "../screens/admin/AdminReportsScreen";
import { stackHeaderOptions } from "./headerOptions";
import type {
  AdminBookingsStackParamList,
  AdminCafeStackParamList,
  AdminCalendarStackParamList,
  AdminExpensesStackParamList,
  AdminMoreStackParamList,
  AdminRewardsStackParamList,
  AdminTabsParamList,
  RootStackParamList,
} from "./types";

const BookingsStack = createNativeStackNavigator<AdminBookingsStackParamList>();
const CalendarStack =
  createNativeStackNavigator<AdminCalendarStackParamList>();
const CafeStack = createNativeStackNavigator<AdminCafeStackParamList>();
const ExpensesStack =
  createNativeStackNavigator<AdminExpensesStackParamList>();
const RewardsStack = createNativeStackNavigator<AdminRewardsStackParamList>();
const MoreStack = createNativeStackNavigator<AdminMoreStackParamList>();
const Tabs = createBottomTabNavigator<AdminTabsParamList>();

/**
 * "More" hub stack. Root is the grouped, permission-gated menu; Phase 1+
 * secondary admin screens register here so the hub can push to them.
 */
function AdminMoreStackNav() {
  return (
    <MoreStack.Navigator
      screenOptions={stackHeaderOptions}
    >
      <MoreStack.Screen
        name="AdminMoreHome"
        component={AdminMoreScreen}
        options={{ headerShown: false }}
      />
      <MoreStack.Screen
        name="AdminSports"
        component={AdminSportsScreen}
        options={{ title: "Sports" }}
      />
      <MoreStack.Screen
        name="AdminEquipment"
        component={AdminEquipmentScreen}
        options={{ title: "Equipment" }}
      />
      <MoreStack.Screen
        name="AdminBowling"
        component={AdminBowlingScreen}
        options={{ title: "Bowling machine" }}
      />
      <MoreStack.Screen
        name="AdminPricing"
        component={AdminPricingScreen}
        options={{ title: "Pricing" }}
      />
      <MoreStack.Screen
        name="AdminSlotBlocks"
        component={AdminSlotBlocksScreen}
        options={{ title: "Slot blocks" }}
      />
      <MoreStack.Screen
        name="AdminCoupons"
        component={AdminCouponsScreen}
        options={{ title: "Coupons" }}
      />
      <MoreStack.Screen
        name="AdminPasses"
        component={AdminPassesScreen}
        options={{ title: "Monthly passes" }}
      />
      <MoreStack.Screen
        name="AdminRainBanner"
        component={AdminRainBannerScreen}
        options={{ title: "Rain banner" }}
      />
      <MoreStack.Screen
        name="AdminPromoBanners"
        component={AdminPromoBannersScreen}
        options={{ title: "Promotion banners" }}
      />
      <MoreStack.Screen
        name="AdminProducts"
        component={AdminProductsScreen}
        options={{ title: "Products" }}
      />
      <MoreStack.Screen
        name="AdminProductOrders"
        component={AdminProductOrdersScreen}
        options={{ title: "Shop orders" }}
      />
      <MoreStack.Screen
        name="AdminPos"
        component={AdminPosScreen}
        options={{ title: "Walk-in sale" }}
      />
      <MoreStack.Screen
        name="AdminPush"
        component={AdminPushScreen}
        options={{ title: "Push notifications" }}
      />
      <MoreStack.Screen
        name="AdminPushTemplates"
        component={AdminPushTemplatesScreen}
        options={{ title: "Auto Push Messages" }}
      />
      <MoreStack.Screen
        name="AdminOta"
        component={AdminOtaScreen}
        options={{ title: "App updates" }}
      />
      <MoreStack.Screen
        name="AdminReleaseFlow"
        component={AdminReleaseFlowScreen}
        options={{ title: "Release flow" }}
      />
      <MoreStack.Screen
        name="AdminUsers"
        component={AdminUsersScreen}
        options={{ title: "Users" }}
      />
      <MoreStack.Screen
        name="AdminUserGroups"
        component={AdminUserGroupsScreen}
        options={{ title: "User groups" }}
      />
      <MoreStack.Screen
        name="AdminFaqs"
        component={AdminFaqsScreen}
        options={{ title: "FAQs" }}
      />
      <MoreStack.Screen
        name="AdminGenerator"
        component={AdminGeneratorScreen}
        options={{ title: "Generator" }}
      />
      <MoreStack.Screen name="AdminCafeAnalytics" component={AdminCafeAnalyticsScreen} options={{ title: "Cafe analytics" }} />
      <MoreStack.Screen name="AdminPushAnalytics" component={AdminPushAnalyticsScreen} options={{ title: "Push analytics" }} />
      <MoreStack.Screen name="AdminDemand" component={AdminDemandScreen} options={{ title: "Demand heatmap" }} />
      <MoreStack.Screen name="AdminCohorts" component={AdminCohortsScreen} options={{ title: "Retention cohorts" }} />
      <MoreStack.Screen name="AdminFunnels" component={AdminFunnelsScreen} options={{ title: "Funnels" }} />
      <MoreStack.Screen name="AdminEvents" component={AdminEventsScreen} options={{ title: "Events & logs" }} />
      <MoreStack.Screen name="AdminPaymentSettings" component={AdminPaymentSettingsScreen} options={{ title: "Payment gateway" }} />
      <MoreStack.Screen name="AdminRazorpay" component={AdminRazorpayScreen} options={{ title: "Razorpay" }} />
      <MoreStack.Screen name="AdminPhonePe" component={AdminPhonePeScreen} options={{ title: "PhonePe" }} />
      <MoreStack.Screen name="AdminAdminUsers" component={AdminAdminUsersScreen} options={{ title: "Admin users" }} />
      <MoreStack.Screen name="AdminTrustedDevices" component={AdminTrustedDevicesScreen} options={{ title: "Trusted devices" }} />
      <MoreStack.Screen name="AdminProfile" component={AdminProfileScreen} options={{ title: "My profile" }} />
      <MoreStack.Screen name="AdminRecovery" component={AdminRecoveryScreen} options={{ title: "Payment recovery" }} />
      <MoreStack.Screen name="AdminRecurringConfig" component={AdminRecurringConfigScreen} options={{ title: "Recurring config" }} />
      <MoreStack.Screen name="AdminUtrVerify" component={AdminUtrVerifyScreen} options={{ title: "UTR verify" }} />
      <MoreStack.Screen name="AdminDiscounts" component={AdminDiscountsScreen} options={{ title: "Discount codes" }} />
      <MoreStack.Screen name="AdminReports" component={AdminReportsScreen} options={{ title: "Reports" }} />
    </MoreStack.Navigator>
  );
}

function AdminRewardsStackNav() {
  return (
    <RewardsStack.Navigator
      screenOptions={stackHeaderOptions}
    >
      <RewardsStack.Screen
        name="AdminRewardsHome"
        component={AdminRewardsScreen}
        options={{ headerShown: false }}
      />
      <RewardsStack.Screen
        name="AdminRewardsAnalytics"
        component={AdminRewardsAnalyticsScreen}
        options={{ title: "Rewards analytics" }}
      />
      <RewardsStack.Screen
        name="AdminRewardsDistribute"
        component={AdminRewardsDistributeScreen}
        options={{ title: "Distribute points" }}
      />
      <RewardsStack.Screen
        name="AdminRewardsTransactions"
        component={AdminRewardsTransactionsScreen}
        options={{ title: "Transactions ledger" }}
      />
      <RewardsStack.Screen
        name="AdminRewardsConfig"
        component={AdminRewardsConfigScreen}
        options={{ title: "Reward settings" }}
      />
    </RewardsStack.Navigator>
  );
}

function AdminExpensesStackNav() {
  return (
    <ExpensesStack.Navigator
      screenOptions={stackHeaderOptions}
    >
      <ExpensesStack.Screen
        name="AdminExpensesList"
        component={AdminExpensesListScreen}
        options={{ headerShown: false }}
      />
      <ExpensesStack.Screen
        name="AdminExpenseForm"
        component={AdminExpenseFormScreen}
        options={({ route }) => ({
          title: route.params?.expenseId
            ? route.params?.module === "RUNNING"
              ? "Edit running expense"
              : "Edit expense"
            : route.params?.module === "RUNNING"
              ? "Add running expense"
              : "Add expense",
        })}
      />
      <ExpensesStack.Screen
        name="AdminExpenseAnalytics"
        component={AdminExpenseAnalyticsScreen}
        options={({ route }) => ({
          title:
            route.params?.module === "RUNNING"
              ? "Running Expense Analytics"
              : "Analytics",
        })}
      />
    </ExpensesStack.Navigator>
  );
}

function AdminCafeStackNav() {
  return (
    <CafeStack.Navigator
      screenOptions={stackHeaderOptions}
    >
      <CafeStack.Screen
        name="AdminCafeOrders"
        component={AdminCafeOrdersScreen}
        options={{ headerShown: false }}
      />
      <CafeStack.Screen
        name="AdminCafeMenu"
        component={AdminCafeMenuScreen}
        options={{ title: "Menu" }}
      />
      <CafeStack.Screen
        name="AdminCafeCreateOrder"
        component={AdminCafeCreateOrderScreen}
        options={{ title: "New cafe order" }}
      />
    </CafeStack.Navigator>
  );
}

function AdminCalendarStackNav() {
  return (
    <CalendarStack.Navigator
      screenOptions={stackHeaderOptions}
    >
      <CalendarStack.Screen
        name="AdminCalendar"
        component={AdminCalendarScreen}
        options={{ headerShown: false }}
      />
    </CalendarStack.Navigator>
  );
}

function AdminBookingsStack() {
  return (
    <BookingsStack.Navigator
      screenOptions={stackHeaderOptions}
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
      <BookingsStack.Screen
        name="AdminEditPayment"
        component={AdminEditPaymentScreen}
        options={{ title: "Edit Payment" }}
      />
      <BookingsStack.Screen
        name="AdminCreateBooking"
        component={AdminCreateBookingScreen}
        options={{ title: "New Booking" }}
      />
    </BookingsStack.Navigator>
  );
}

/**
 * Admin shell. Reached either from the AdminLogin success handler
 * or by 5-tapping the Account-screen version footer when an admin
 * session already exists in Keychain.
 *
 * Five bottom tabs mirror the seven web admin sections, grouped by
 * floor-staff workflow:
 *   - Bookings: list + detail + filters + actions (covers the
 *     all-bookings + unconfirmed views).
 *   - Check-in: today's confirmed bookings + QR-token entry.
 *   - Calendar: court×hour grid for any single date + slot-blocks.
 *   - Cafe: orders kanban + menu availability toggle.
 *   - Expenses: list + add/edit form + analytics.
 *
 * The header on every tab carries the same two utility buttons:
 *   - "Customer view" → switches to the customer Main stack without
 *     signing the admin out, so a staffer can quickly check what a
 *     customer sees and come back via the 5-tap.
 *   - Sign-out → clears the admin token and returns to customer view.
 */
export function AdminNavigator() {
  const { state } = useAdminAuth();
  const admin = state.status === "signedIn" ? state.admin : null;
  // Hide a tab from the bottom bar when the admin lacks its permission
  // (mirrors the web sidebar's per-section gating). The screen stays
  // registered so deep-links / quick-actions still resolve.
  const hiddenTab = {
    tabBarButton: () => null,
    tabBarItemStyle: { display: "none" as const },
  };
  return (
    <Tabs.Navigator
      // Calendar is the admin landing screen on login (not the dashboard).
      initialRouteName="AdminCalendar"
      screenOptions={({ route }) => ({
        header: () => <AdminHeader title={titleFor(route)} />,
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
            case "AdminSportsAnalytics":
              return <BarChart3 {...props} />;
            case "AdminBookings":
              return <CalendarCheck {...props} />;
            case "AdminCalendar":
              return <CalendarRange {...props} />;
            case "AdminCafe":
              return <Coffee {...props} />;
            case "AdminMore":
              return <Menu {...props} />;
            // Hidden tabs (Checkin/Expenses/Rewards) render no bar icon.
            default:
              return null;
          }
        },
      })}
    >
      <Tabs.Screen
        name="AdminSportsAnalytics"
        component={AdminSportsAnalyticsScreen}
        options={
          adminCan(admin, "VIEW_ANALYTICS")
            ? { tabBarLabel: "Analytics" }
            : hiddenTab
        }
      />
      <Tabs.Screen
        name="AdminBookings"
        component={AdminBookingsStack}
        options={
          adminCan(admin, "MANAGE_BOOKINGS")
            ? { tabBarLabel: "Bookings" }
            : hiddenTab
        }
      />
      <Tabs.Screen
        name="AdminCalendar"
        component={AdminCalendarStackNav}
        options={
          adminCan(admin, "MANAGE_BOOKINGS")
            ? { tabBarLabel: "Calendar" }
            : hiddenTab
        }
      />
      <Tabs.Screen
        name="AdminCafe"
        component={AdminCafeStackNav}
        options={
          adminCan(admin, "MANAGE_CAFE_ORDERS")
            ? { tabBarLabel: "Cafe" }
            : hiddenTab
        }
      />
      <Tabs.Screen
        name="AdminMore"
        component={AdminMoreStackNav}
        options={{ tabBarLabel: "More" }}
      />
      {/* Secondary tabs — reachable from the dashboard quick-actions and the
          More hub, but hidden from the bottom bar to keep it to five. */}
      {/* Dashboard is no longer a bottom tab (Analytics took its slot); it
          stays registered (hidden) so quick-action deep-links + the More-hub
          "Dashboard" row still resolve. */}
      <Tabs.Screen
        name="AdminHome"
        component={AdminDashboardScreen}
        options={{
          tabBarButton: () => null,
          tabBarItemStyle: { display: "none" },
        }}
      />
      <Tabs.Screen
        name="AdminCheckin"
        component={AdminCheckinScreen}
        options={{
          tabBarButton: () => null,
          tabBarItemStyle: { display: "none" },
        }}
      />
      <Tabs.Screen
        name="AdminExpenses"
        component={AdminExpensesStackNav}
        options={{
          tabBarButton: () => null,
          tabBarItemStyle: { display: "none" },
        }}
      />
      <Tabs.Screen
        name="AdminRewards"
        component={AdminRewardsStackNav}
        options={{
          tabBarButton: () => null,
          tabBarItemStyle: { display: "none" },
        }}
      />
    </Tabs.Navigator>
  );
}

type AdminTabRoute = RouteProp<AdminTabsParamList, keyof AdminTabsParamList>;

function titleFor(route: AdminTabRoute): string {
  switch (route.name) {
    case "AdminSportsAnalytics":
      return "Sports Analytics";
    case "AdminHome":
      return "Dashboard";
    case "AdminBookings":
      return "Bookings";
    case "AdminCheckin":
      return "Check-in";
    case "AdminCalendar":
      return "Calendar";
    case "AdminCafe":
      return "Cafe";
    case "AdminExpenses":
      return expensesTabIsRunning(route) ? "Running Expenses" : "Expenses";
    case "AdminRewards":
      return "Rewards";
    case "AdminMore":
      return "More";
  }
}

/**
 * The Expenses tab hosts two flavors of the same nested stack — the
 * classic GENERAL log and the RUNNING (month-wise) ledger — switched
 * by the `module` param on the focused nested route. The tab-level
 * header has to peek into the nested navigator state for it; before
 * the nested navigator has mounted, the pending `{ screen, params }`
 * payload sits on the tab route's own params instead. Neither shape
 * is on the RouteProp type, hence the local cast.
 */
function expensesTabIsRunning(route: AdminTabRoute): boolean {
  const r = route as unknown as {
    state?: {
      index?: number;
      routes?: Array<{ params?: { module?: string } }>;
    };
    params?: { params?: { module?: string } };
  };
  const focused = r.state?.routes?.[r.state?.index ?? 0]?.params;
  const pending = r.params?.params;
  return (focused ?? pending)?.module === "RUNNING";
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
          // Use reset() instead of navigate() so AdminShell is
          // actually POPPED from the root native-stack — not just
          // visually covered by Main pushed on top. Otherwise a
          // swipe-down (or any iOS modal-dismiss gesture on the
          // root navigator) re-reveals AdminShell underneath, which
          // surfaces as "I went back to customer, then a fast pull
          // on Account brought admin back".
          onPress={() =>
            navigation.reset({
              index: 0,
              routes: [{ name: "Main", params: { screen: "Home" } }],
            })
          }
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
              // Same reset for the sign-out path — wipe AdminShell
              // off the stack so a stale gesture can't navigate
              // back into a logged-out admin context.
              navigation.reset({
                index: 0,
                routes: [{ name: "Main", params: { screen: "Home" } }],
              });
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
