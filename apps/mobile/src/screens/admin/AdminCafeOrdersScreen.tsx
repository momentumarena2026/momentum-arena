import { useEffect, type ReactNode } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ChefHat,
  Clock,
  Coffee,
  Flame,
  PackageCheck,
  TrendingUp,
  Utensils,
  XCircle,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminCafeApi,
  type CafeOrderListItem,
  type CafeOrderStatus,
  type LiveCafeOrders,
} from "../../lib/admin-cafe";
import { AdminApiError } from "../../lib/admin-api";
import { formatRupees } from "../../lib/format";
import type { AdminCafeStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<
  AdminCafeStackParamList,
  "AdminCafeOrders"
>;

const STATUS_META: Record<
  Exclude<CafeOrderStatus, "COMPLETED" | "CANCELLED">,
  { label: string; color: string; bg: string; border: string; emoji: string }
> = {
  PENDING: {
    label: "Pending",
    color: colors.yellow400,
    bg: "rgba(250, 204, 21, 0.10)",
    border: "rgba(250, 204, 21, 0.30)",
    emoji: "🕐",
  },
  PREPARING: {
    label: "Preparing",
    color: "#fb923c",
    bg: "rgba(251, 146, 60, 0.10)",
    border: "rgba(251, 146, 60, 0.30)",
    emoji: "🔥",
  },
  READY: {
    label: "Ready",
    color: colors.emerald400,
    bg: "rgba(34, 197, 94, 0.10)",
    border: "rgba(34, 197, 94, 0.30)",
    emoji: "✅",
  },
};

const NEXT_STATUS: Record<
  "PENDING" | "PREPARING" | "READY",
  { next: CafeOrderStatus; verb: string }
> = {
  PENDING: { next: "PREPARING", verb: "Start" },
  PREPARING: { next: "READY", verb: "Mark ready" },
  READY: { next: "COMPLETED", verb: "Complete" },
};

/**
 * Mirrors the web /admin/cafe-orders kanban + stats strip. Three
 * lanes (Pending → Preparing → Ready) stack vertically on mobile;
 * within a lane, oldest order is at the top so the kitchen FIFO is
 * obvious. Per-card: advance to next status, or cancel.
 *
 * Polls every 30s while the screen is focused so a kitchen tablet
 * left on the cafe screen stays current without a manual refresh.
 */
export function AdminCafeOrdersScreen() {
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();

  const orders = useQuery({
    queryKey: ["admin-cafe-live"],
    queryFn: () => adminCafeApi.liveOrders(),
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
  const stats = useQuery({
    queryKey: ["admin-cafe-stats"],
    queryFn: () => adminCafeApi.orderStats(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  const advance = useMutation({
    mutationFn: ({
      id,
      newStatus,
    }: {
      id: string;
      newStatus: CafeOrderStatus;
    }) => adminCafeApi.setOrderStatus(id, newStatus),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-cafe-live"] });
      void qc.invalidateQueries({ queryKey: ["admin-cafe-stats"] });
    },
    onError: (err) =>
      Alert.alert(
        "Couldn't update",
        err instanceof AdminApiError ? err.message : "Try again.",
      ),
  });

  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      adminCafeApi.cancelOrder(id, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-cafe-live"] });
      void qc.invalidateQueries({ queryKey: ["admin-cafe-stats"] });
    },
    onError: (err) =>
      Alert.alert(
        "Couldn't cancel",
        err instanceof AdminApiError ? err.message : "Try again.",
      ),
  });

  useEffect(() => {
    // Refetch when the screen mounts so a navigate-back lands on
    // fresh data even while the polling interval is mid-cycle.
    void orders.refetch();
    void stats.refetch();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshing =
    (orders.isFetching && !orders.isLoading) || orders.isRefetching;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void orders.refetch();
              void stats.refetch();
            }}
            tintColor={colors.yellow400}
          />
        }
      >
        {/* Stats strip */}
        <View style={styles.statRow}>
          <StatCard
            icon={<Utensils size={14} color={colors.yellow400} />}
            label="Today orders"
            value={stats.data ? String(stats.data.todayOrders) : "…"}
          />
          <StatCard
            icon={<TrendingUp size={14} color={colors.emerald400} />}
            label="Revenue"
            value={
              stats.data ? formatRupees(stats.data.todayRevenue) : "…"
            }
          />
          <StatCard
            icon={<Clock size={14} color={"#fb923c"} />}
            label="Pending"
            value={stats.data ? String(stats.data.pendingCount) : "…"}
          />
        </View>

        {/* Menu shortcut */}
        <Pressable
          onPress={() => navigation.navigate("AdminCafeMenu")}
          style={({ pressed }) => [
            styles.menuBtn,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Coffee size={14} color={colors.zinc300} />
          <Text variant="small" color={colors.zinc300} weight="600">
            Manage menu
          </Text>
        </Pressable>

        {/* Lanes */}
        {orders.isLoading ? (
          <KanbanSkeleton />
        ) : orders.isError ? (
          <Pressable
            onPress={() => void orders.refetch()}
            style={styles.errorBlock}
          >
            <Text variant="body" color={colors.destructive}>
              Couldn't load orders. Tap to retry.
            </Text>
            <Text variant="tiny" color={colors.zinc500}>
              {orders.error instanceof Error
                ? orders.error.message
                : "Unknown error"}
            </Text>
          </Pressable>
        ) : (
          <Kanban
            data={orders.data!}
            onAdvance={(id, newStatus) =>
              advance.mutate({ id, newStatus })
            }
            onCancel={(id) =>
              promptCancelReason((reason) =>
                cancel.mutate({ id, reason }),
              )
            }
            advancingId={
              advance.isPending && advance.variables
                ? advance.variables.id
                : null
            }
            cancellingId={
              cancel.isPending && cancel.variables ? cancel.variables.id : null
            }
          />
        )}
      </ScrollView>
    </Screen>
  );
}

function promptCancelReason(submit: (reason: string) => void) {
  // Mobile RN doesn't have a native prompt-input on Android, so we
  // canned a small set of common cancel reasons. The 90% case for
  // floor staff is "wrong order / customer left / kitchen issue" —
  // freeform comments are a web-admin nicety.
  Alert.alert("Cancel order?", "Why is this order being cancelled?", [
    { text: "Keep order", style: "cancel" },
    { text: "Customer cancelled", onPress: () => submit("Customer cancelled") },
    { text: "Kitchen issue", onPress: () => submit("Kitchen issue") },
    { text: "Out of stock", onPress: () => submit("Out of stock") },
  ]);
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statHead}>
        {icon}
        <Text variant="tiny" color={colors.zinc500}>
          {label}
        </Text>
      </View>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

function Kanban({
  data,
  onAdvance,
  onCancel,
  advancingId,
  cancellingId,
}: {
  data: LiveCafeOrders;
  onAdvance: (id: string, newStatus: CafeOrderStatus) => void;
  onCancel: (id: string) => void;
  advancingId: string | null;
  cancellingId: string | null;
}) {
  const lanes: ("PENDING" | "PREPARING" | "READY")[] = [
    "PENDING",
    "PREPARING",
    "READY",
  ];
  return (
    <View style={{ gap: spacing["3"] }}>
      {lanes.map((lane) => {
        const meta = STATUS_META[lane];
        const items = data[lane];
        return (
          <View
            key={lane}
            style={[
              styles.lane,
              { borderColor: meta.border, backgroundColor: meta.bg },
            ]}
          >
            <View style={styles.laneHead}>
              <LaneIcon lane={lane} />
              <Text variant="bodyStrong" color={meta.color}>
                {meta.label}
              </Text>
              <Text
                variant="tiny"
                color={meta.color}
                style={styles.laneCount}
                weight="600"
              >
                {items.length}
              </Text>
            </View>
            {items.length === 0 ? (
              <Text variant="tiny" color={colors.zinc500}>
                Nothing here yet.
              </Text>
            ) : (
              <View style={{ gap: spacing["2"] }}>
                {items.map((o) => (
                  <OrderCard
                    key={o.id}
                    order={o}
                    onAdvance={() => onAdvance(o.id, NEXT_STATUS[lane].next)}
                    advanceLabel={NEXT_STATUS[lane].verb}
                    onCancel={() => onCancel(o.id)}
                    isAdvancing={advancingId === o.id}
                    isCancelling={cancellingId === o.id}
                  />
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function LaneIcon({
  lane,
}: {
  lane: "PENDING" | "PREPARING" | "READY";
}) {
  const meta = STATUS_META[lane];
  switch (lane) {
    case "PENDING":
      return <Clock size={14} color={meta.color} />;
    case "PREPARING":
      return <Flame size={14} color={meta.color} />;
    case "READY":
      return <PackageCheck size={14} color={meta.color} />;
  }
}

function OrderCard({
  order,
  onAdvance,
  advanceLabel,
  onCancel,
  isAdvancing,
  isCancelling,
}: {
  order: CafeOrderListItem;
  onAdvance: () => void;
  advanceLabel: string;
  onCancel: () => void;
  isAdvancing: boolean;
  isCancelling: boolean;
}) {
  const customer =
    order.user?.name ||
    order.user?.phone ||
    order.guestName ||
    order.guestPhone ||
    "Walk-in";
  const ageMin = Math.max(
    0,
    Math.round(
      (Date.now() - new Date(order.createdAt).getTime()) / 60_000,
    ),
  );
  return (
    <View style={styles.orderCard}>
      <View style={styles.orderHead}>
        <Text variant="bodyStrong">#{order.orderNumber}</Text>
        <Text variant="tiny" color={colors.zinc500}>
          {ageMin}m · {customer}
        </Text>
      </View>
      <View style={{ gap: 2 }}>
        {order.items.map((line) => (
          <Text
            key={line.id}
            variant="small"
            color={colors.zinc300}
            numberOfLines={1}
          >
            <Text variant="small" color={colors.yellow400} weight="600">
              {line.quantity}×
            </Text>{" "}
            {line.itemName}
            {line.isVeg === false ? "  🍗" : line.isVeg === true ? "  🥬" : ""}
          </Text>
        ))}
      </View>
      {order.note ? (
        <Text variant="tiny" color={colors.zinc500} numberOfLines={2}>
          Note: {order.note}
        </Text>
      ) : null}
      <View style={styles.orderFoot}>
        <Text variant="small" color={colors.zinc400}>
          {formatRupees(order.totalAmount)}
        </Text>
        <View style={styles.orderActions}>
          <Pressable
            onPress={onCancel}
            disabled={isCancelling}
            style={({ pressed }) => [
              styles.actionBtn,
              styles.actionDanger,
              isCancelling && { opacity: 0.5 },
              pressed && { opacity: 0.7 },
            ]}
          >
            <XCircle size={12} color={colors.destructive} />
            <Text variant="tiny" color={colors.destructive} weight="600">
              {isCancelling ? "…" : "Cancel"}
            </Text>
          </Pressable>
          <Pressable
            onPress={onAdvance}
            disabled={isAdvancing}
            style={({ pressed }) => [
              styles.actionBtn,
              styles.actionPrimary,
              isAdvancing && { opacity: 0.5 },
              pressed && { opacity: 0.7 },
            ]}
          >
            <ChefHat size={12} color={colors.yellow400} />
            <Text variant="tiny" color={colors.yellow400} weight="600">
              {isAdvancing ? "…" : advanceLabel}
            </Text>
            <ArrowRight size={11} color={colors.yellow400} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function KanbanSkeleton() {
  return (
    <View style={{ gap: spacing["3"] }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.lane}>
          <Skeleton width="40%" height={14} />
          <Skeleton width="100%" height={120} rounded="md" />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  statRow: {
    flexDirection: "row",
    gap: spacing["2"],
  },
  statCard: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["3"],
    gap: 6,
  },
  statHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  menuBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["1.5"],
    paddingVertical: spacing["2.5"],
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  lane: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.zinc800,
    padding: spacing["3"],
    gap: spacing["2"],
  },
  laneHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  laneCount: {
    marginLeft: "auto",
    paddingHorizontal: spacing["2"],
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  orderCard: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.background,
    padding: spacing["3"],
    gap: spacing["2"],
  },
  orderHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  orderFoot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing["2"],
  },
  orderActions: {
    flexDirection: "row",
    gap: spacing["1.5"],
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing["2.5"],
    paddingVertical: spacing["1.5"],
    borderRadius: 999,
    borderWidth: 1,
  },
  actionPrimary: {
    borderColor: "rgba(250, 204, 21, 0.40)",
    backgroundColor: "rgba(250, 204, 21, 0.10)",
  },
  actionDanger: {
    borderColor: "rgba(239, 68, 68, 0.30)",
    backgroundColor: "rgba(239, 68, 68, 0.10)",
  },
  errorBlock: {
    padding: spacing["4"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.30)",
    backgroundColor: "rgba(239, 68, 68, 0.10)",
    gap: spacing["1"],
  },
});
