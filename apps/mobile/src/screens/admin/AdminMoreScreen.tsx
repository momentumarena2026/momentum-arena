import { ScrollView, StyleSheet, View, Pressable } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import {
  Activity,
  Ban,
  BarChart3,
  Bell,
  ChevronRight,
  Coffee,
  CreditCard,
  FileText,
  Gift,
  IndianRupee,
  LayoutGrid,
  Megaphone,
  Package,
  RefreshCw,
  ScanLine,
  Settings2,
  ShoppingBag,
  Sparkles,
  Tag,
  Target,
  Ticket,
  Users,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { colors, radius, spacing } from "../../theme";
import { useAdminAuth } from "../../providers/AdminAuthProvider";
import { adminCan, type AdminPermission } from "../../lib/admin-permissions";
import type { AdminTabsParamList } from "../../navigation/types";

type TabsNav = BottomTabNavigationProp<AdminTabsParamList>;

// React Navigation's typed `navigate` overloads choke on cross-navigator
// jumps from a nested stack; a minimal call signature keeps the rows clean
// without per-call casts (the route names are still authored against the
// real param lists below).
type NavLike = { navigate: (name: string, params?: object) => void };

interface Row {
  label: string;
  sub?: string;
  icon: React.ReactNode;
  /** null = visible to every admin. */
  perm: AdminPermission | null;
  /** Present = live; absent = "Soon" (built in a later phase). */
  onPress?: (nav: NavLike) => void;
}

interface Group {
  title: string;
  rows: Row[];
}

const ic = (Icon: typeof Users, color: string = colors.zinc300) => (
  <Icon size={18} color={color} />
);

// Mirrors the web admin sidebar groups. Live rows have an onPress; the rest
// render a "Soon" badge and become live as their phase ships.
const GROUPS: Group[] = [
  {
    title: "General",
    rows: [
      {
        label: "Reports",
        sub: "Queue + track monthly exports",
        icon: ic(FileText),
        perm: "VIEW_ANALYTICS",
        onPress: (nav) => nav.navigate("AdminReports"),
      },
    ],
  },
  {
    title: "Bookings",
    rows: [
      {
        label: "Check-in",
        sub: "Today's confirmed + QR lookup",
        icon: ic(ScanLine, colors.yellow400),
        perm: "MANAGE_BOOKINGS",
        onPress: (t) => t.navigate("AdminCheckin"),
      },
      {
        label: "Payment recovery",
        icon: ic(CreditCard),
        perm: "MANAGE_BOOKINGS",
        onPress: (nav) => nav.navigate("AdminRecovery"),
      },
      {
        label: "UTR verify",
        icon: ic(ScanLine),
        perm: "MANAGE_BOOKINGS",
        onPress: (nav) => nav.navigate("AdminUtrVerify"),
      },
      {
        label: "Recurring config",
        icon: ic(RefreshCw),
        perm: "MANAGE_PRICING",
        onPress: (nav) => nav.navigate("AdminRecurringConfig"),
      },
    ],
  },
  {
    title: "Courts & Pricing",
    rows: [
      {
        label: "Sports",
        icon: ic(LayoutGrid),
        perm: "MANAGE_SPORTS",
        onPress: (nav) => nav.navigate("AdminSports"),
      },
      {
        label: "Equipment",
        icon: ic(Package),
        perm: "MANAGE_SPORTS",
        onPress: (nav) => nav.navigate("AdminEquipment"),
      },
      {
        label: "Bowling machine",
        icon: ic(Target),
        perm: "MANAGE_SPORTS",
        onPress: (nav) => nav.navigate("AdminBowling"),
      },
      {
        label: "Pricing",
        icon: ic(IndianRupee),
        perm: "MANAGE_PRICING",
        onPress: (nav) => nav.navigate("AdminPricing"),
      },
      {
        label: "Slot blocks",
        icon: ic(Ban),
        perm: "MANAGE_SLOTS",
        onPress: (nav) => nav.navigate("AdminSlotBlocks"),
      },
    ],
  },
  {
    title: "Cafe",
    rows: [
      {
        label: "Cafe menu",
        icon: ic(Coffee),
        perm: "MANAGE_CAFE_MENU",
        onPress: (nav) =>
          nav.navigate("AdminCafe", { screen: "AdminCafeMenu" }),
      },
      {
        label: "Live orders",
        icon: ic(Activity),
        perm: "MANAGE_CAFE_ORDERS",
        onPress: (nav) =>
          nav.navigate("AdminCafe", { screen: "AdminCafeOrders" }),
      },
      {
        label: "Create cafe order",
        icon: ic(ShoppingBag),
        perm: "MANAGE_CAFE_ORDERS",
        onPress: (nav) =>
          nav.navigate("AdminCafe", { screen: "AdminCafeCreateOrder" }),
      },
    ],
  },
  {
    title: "Shop",
    rows: [
      {
        label: "Products",
        icon: ic(Package),
        perm: "MANAGE_SHOP_CATALOG",
        onPress: (nav) => nav.navigate("AdminProducts"),
      },
      {
        label: "Shop orders",
        icon: ic(ShoppingBag),
        perm: "MANAGE_SHOP_ORDERS",
        onPress: (nav) => nav.navigate("AdminProductOrders"),
      },
      {
        label: "Walk-in sale (POS)",
        icon: ic(CreditCard),
        perm: "MANAGE_SHOP_ORDERS",
        onPress: (nav) => nav.navigate("AdminPos"),
      },
    ],
  },
  {
    title: "Promotions",
    rows: [
      {
        label: "Coupons",
        icon: ic(Ticket),
        perm: "MANAGE_COUPONS",
        onPress: (nav) => nav.navigate("AdminCoupons"),
      },
      {
        label: "Rewards",
        sub: "Points overview, alerts, grant",
        icon: ic(Sparkles, colors.yellow400),
        perm: "MANAGE_REWARDS",
        onPress: (t) => t.navigate("AdminRewards"),
      },
      {
        label: "Discount codes",
        sub: "Legacy codes",
        icon: ic(Tag),
        perm: "MANAGE_DISCOUNTS",
        onPress: (nav) => nav.navigate("AdminDiscounts"),
      },
    ],
  },
  {
    title: "Operations",
    rows: [
      {
        label: "Expenses",
        sub: "Log + analytics",
        icon: ic(IndianRupee, colors.emerald400),
        perm: "MANAGE_EXPENSES",
        onPress: (t) => t.navigate("AdminExpenses"),
      },
    ],
  },
  {
    title: "Analytics",
    rows: [
      { label: "Sports analytics", icon: ic(BarChart3), perm: "VIEW_ANALYTICS", onPress: (nav) => nav.navigate("AdminSportsAnalytics") },
      { label: "Cafe analytics", icon: ic(BarChart3), perm: "VIEW_ANALYTICS", onPress: (nav) => nav.navigate("AdminCafeAnalytics") },
      { label: "Push analytics", icon: ic(BarChart3), perm: "VIEW_ANALYTICS", onPress: (nav) => nav.navigate("AdminPushAnalytics") },
      { label: "Demand heatmap", icon: ic(BarChart3), perm: "VIEW_ANALYTICS", onPress: (nav) => nav.navigate("AdminDemand") },
      { label: "Retention cohorts", icon: ic(BarChart3), perm: "VIEW_ANALYTICS", onPress: (nav) => nav.navigate("AdminCohorts") },
      { label: "Funnels", icon: ic(BarChart3), perm: "VIEW_ANALYTICS", onPress: (nav) => nav.navigate("AdminFunnels") },
      { label: "Events & logs", icon: ic(FileText), perm: "VIEW_ANALYTICS", onPress: (nav) => nav.navigate("AdminEvents") },
    ],
  },
  {
    title: "Engagement",
    rows: [
      {
        label: "Push notifications",
        icon: ic(Bell),
        perm: "MANAGE_PUSH",
        onPress: (nav) => nav.navigate("AdminPush"),
      },
      {
        label: "App updates (OTA)",
        icon: ic(Megaphone),
        perm: "MANAGE_PRICING",
        onPress: (nav) => nav.navigate("AdminOta"),
      },
      {
        label: "Release flow",
        icon: ic(FileText),
        perm: "MANAGE_PRICING",
        onPress: (nav) => nav.navigate("AdminReleaseFlow"),
      },
    ],
  },
  {
    title: "Settings",
    rows: [
      {
        label: "Users",
        icon: ic(Users),
        perm: "MANAGE_USERS",
        onPress: (nav) => nav.navigate("AdminUsers"),
      },
      {
        label: "User groups",
        icon: ic(Users),
        perm: "MANAGE_COUPONS",
        onPress: (nav) => nav.navigate("AdminUserGroups"),
      },
      {
        label: "FAQs",
        icon: ic(FileText),
        perm: "MANAGE_FAQS",
        onPress: (nav) => nav.navigate("AdminFaqs"),
      },
      {
        label: "Generator",
        icon: ic(Settings2),
        perm: "MANAGE_PRICING",
        onPress: (nav) => nav.navigate("AdminGenerator"),
      },
      {
        label: "Payment gateway",
        icon: ic(CreditCard),
        perm: "VIEW_RAZORPAY",
        onPress: (nav) => nav.navigate("AdminPaymentSettings"),
      },
      {
        label: "Razorpay",
        icon: ic(IndianRupee),
        perm: "VIEW_RAZORPAY",
        onPress: (nav) => nav.navigate("AdminRazorpay"),
      },
      {
        label: "Admin users",
        icon: ic(Settings2),
        perm: "MANAGE_ADMIN_USERS",
        onPress: (nav) => nav.navigate("AdminAdminUsers"),
      },
      {
        label: "My profile",
        icon: ic(Gift),
        perm: null,
        onPress: (nav) => nav.navigate("AdminProfile"),
      },
    ],
  },
];

export function AdminMoreScreen() {
  const navigation = useNavigation<TabsNav>();
  const { state } = useAdminAuth();
  const admin = state.status === "signedIn" ? state.admin : null;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {GROUPS.map((group) => {
          const visible = group.rows.filter((r) => adminCan(admin, r.perm));
          if (visible.length === 0) return null;
          return (
            <View key={group.title} style={styles.group}>
              <Text
                variant="tiny"
                color={colors.zinc500}
                style={styles.groupLabel}
              >
                {group.title.toUpperCase()}
              </Text>
              <View style={styles.card}>
                {visible.map((row, i) => {
                  const live = !!row.onPress;
                  return (
                    <Pressable
                      key={row.label}
                      disabled={!live}
                      onPress={() =>
                        row.onPress?.(navigation as unknown as NavLike)
                      }
                      style={({ pressed }) => [
                        styles.row,
                        i > 0 && styles.rowBorder,
                        pressed && live && { opacity: 0.7 },
                      ]}
                    >
                      <View style={styles.rowIcon}>{row.icon}</View>
                      <View style={styles.rowBody}>
                        <Text
                          variant="body"
                          weight="500"
                          color={live ? colors.foreground : colors.zinc500}
                        >
                          {row.label}
                        </Text>
                        {row.sub ? (
                          <Text variant="tiny" color={colors.zinc500}>
                            {row.sub}
                          </Text>
                        ) : null}
                      </View>
                      {live ? (
                        <ChevronRight size={18} color={colors.zinc600} />
                      ) : (
                        <View style={styles.soonBadge}>
                          <Text variant="tiny" color={colors.zinc500}>
                            Soon
                          </Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["10"],
    gap: spacing["5"],
  },
  group: { gap: spacing["2"] },
  groupLabel: { letterSpacing: 1.5, fontWeight: "700" },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    paddingHorizontal: spacing["4"],
    paddingVertical: spacing["3.5"],
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.zinc800,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.zinc800,
  },
  rowBody: { flex: 1, gap: 1 },
  soonBadge: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.zinc800,
  },
});
