import { useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  PackageCheck,
  ShoppingBag,
  XCircle,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminShopApi,
  type ShopOrderDetail,
  type ShopOrderListItem,
  type ShopOrderStatus,
} from "../../lib/admin-shop";
import { AdminApiError } from "../../lib/admin-api";
import { formatRupees } from "../../lib/format";

type StatusFilter = ShopOrderStatus | "ALL";

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "ALL", label: "All" },
  { id: "PENDING", label: "Pending" },
  { id: "CONFIRMED", label: "Confirmed" },
  { id: "FULFILLED", label: "Fulfilled" },
  { id: "CANCELLED", label: "Cancelled" },
  { id: "REFUNDED", label: "Refunded" },
];

const STATUS_COLOUR: Record<ShopOrderStatus, string> = {
  PENDING: colors.warning,
  CONFIRMED: colors.emerald400,
  FULFILLED: colors.emerald500,
  CANCELLED: colors.destructive,
  REFUNDED: "#60a5fa",
};

function paymentMethodLabel(method: string | undefined | null): string {
  if (!method) return "—";
  if (method === "UPI_QR") return "UPI QR";
  return method.charAt(0) + method.slice(1).toLowerCase();
}

/** Paise → ₹ helper — the shop domain stores money in paise. */
function rupees(paise: number): string {
  return formatRupees(Math.round(paise / 100));
}

/**
 * Mirrors the web /admin/product-orders list + detail. Status filter
 * chips at the top, an analytics summary strip, then the order list.
 * Tapping a row expands an inline detail (items / customer / payment)
 * with Confirm payment / Mark fulfilled / Cancel actions.
 */
export function AdminProductOrdersScreen() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["admin", "shop-orders", status, submittedSearch],
    queryFn: () =>
      adminShopApi.orders({
        status: status === "ALL" ? undefined : status,
        search: submittedSearch || undefined,
      }),
  });

  const orders = list.data?.orders ?? [];
  const summary = list.data?.summary;
  const refreshing = list.isFetching && !list.isLoading;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void list.refetch()}
            tintColor={colors.emerald400}
          />
        }
      >
        {/* Summary strip */}
        {summary ? (
          <View style={styles.statRow}>
            <StatCard label="Orders" value={String(summary.orderCount)} />
            <StatCard label="Revenue" value={rupees(summary.revenuePaise)} />
            <StatCard
              label="Profit"
              value={rupees(summary.profitPaise)}
              sub={`${summary.marginPct}% margin`}
            />
          </View>
        ) : null}

        {/* Search */}
        <Input
          placeholder="Order #, customer, phone…"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          onSubmitEditing={() => setSubmittedSearch(search.trim())}
        />

        {/* Status filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {FILTERS.map((f) => {
            const active = status === f.id;
            return (
              <Pressable
                key={f.id}
                onPress={() => setStatus(f.id)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text
                  variant="small"
                  weight="600"
                  color={active ? colors.emerald400 : colors.zinc400}
                >
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* List */}
        {list.isLoading ? (
          <View style={styles.list}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} width="100%" height={76} rounded="lg" />
            ))}
          </View>
        ) : list.isError ? (
          <Pressable onPress={() => void list.refetch()} style={styles.errorBlock}>
            <Text variant="body" color={colors.destructive}>
              Couldn't load orders. Tap to retry.
            </Text>
            <Text variant="tiny" color={colors.zinc500}>
              {list.error instanceof Error ? list.error.message : "Unknown error"}
            </Text>
          </Pressable>
        ) : orders.length === 0 ? (
          <View style={styles.empty}>
            <ShoppingBag size={28} color={colors.zinc600} />
            <Text variant="body" color={colors.zinc500}>
              No orders match this view.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {orders.map((o) => (
              <OrderRow
                key={o.id}
                order={o}
                expanded={expandedId === o.id}
                onToggle={() =>
                  setExpandedId((prev) => (prev === o.id ? null : o.id))
                }
                onChanged={() => {
                  void qc.invalidateQueries({ queryKey: ["admin", "shop-orders"] });
                }}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <View style={styles.statCard}>
      <Text variant="tiny" color={colors.zinc500}>
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
      {sub ? (
        <Text variant="tiny" color={colors.zinc600}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

function OrderRow({
  order,
  expanded,
  onToggle,
  onChanged,
}: {
  order: ShopOrderListItem;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  return (
    <Card flush style={styles.orderCard}>
      <Pressable onPress={onToggle} style={styles.orderHead}>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={styles.orderTitleRow}>
            <Text variant="bodyStrong" color={colors.emerald400}>
              {order.orderNumber ?? `#${order.id.slice(-6).toUpperCase()}`}
            </Text>
            {order.isPos ? (
              <View style={styles.posBadge}>
                <Text variant="tiny" color={colors.zinc400} weight="600">
                  POS
                </Text>
              </View>
            ) : null}
          </View>
          <Text variant="small" color={colors.zinc300}>
            {order.customer.name ?? "—"}
            {order.customer.phone ? ` · ${order.customer.phone}` : ""}
          </Text>
          <Text variant="tiny" color={colors.zinc500}>
            {order.itemCount} item{order.itemCount === 1 ? "" : "s"} ·{" "}
            {paymentMethodLabel(order.payment?.method)}
          </Text>
        </View>
        <View style={styles.orderRight}>
          <Text
            variant="tiny"
            weight="700"
            color={STATUS_COLOUR[order.status]}
          >
            {order.status}
          </Text>
          <Text variant="bodyStrong" color={colors.emerald400}>
            {rupees(order.totalPaise)}
          </Text>
          {expanded ? (
            <ChevronUp size={16} color={colors.zinc500} />
          ) : (
            <ChevronDown size={16} color={colors.zinc500} />
          )}
        </View>
      </Pressable>
      {expanded ? <OrderDetail orderId={order.id} onChanged={onChanged} /> : null}
    </Card>
  );
}

function OrderDetail({
  orderId,
  onChanged,
}: {
  orderId: string;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ["admin", "shop-order", orderId],
    queryFn: () => adminShopApi.order(orderId),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "shop-order", orderId] });
    onChanged();
  };

  const confirm = useMutation({
    mutationFn: (utr?: string) => adminShopApi.confirmPayment(orderId, utr),
    onSuccess: invalidate,
    onError: (e) =>
      Alert.alert("Confirm failed", e instanceof AdminApiError ? e.message : "Try again."),
  });
  const fulfill = useMutation({
    mutationFn: () => adminShopApi.markFulfilled(orderId),
    onSuccess: invalidate,
    onError: (e) =>
      Alert.alert("Fulfilment failed", e instanceof AdminApiError ? e.message : "Try again."),
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => adminShopApi.cancel(orderId, reason),
    onSuccess: invalidate,
    onError: (e) =>
      Alert.alert("Cancel failed", e instanceof AdminApiError ? e.message : "Try again."),
  });

  if (detail.isLoading) {
    return (
      <View style={styles.detail}>
        <Skeleton width="100%" height={60} rounded="md" />
      </View>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <View style={styles.detail}>
        <Text variant="small" color={colors.destructive}>
          Couldn't load order detail.
        </Text>
      </View>
    );
  }

  const d: ShopOrderDetail = detail.data;
  const method = d.payment?.method ?? "RAZORPAY";
  const paymentStatus = d.payment?.status ?? "PENDING";
  const canConfirm =
    d.status === "PENDING" &&
    paymentStatus !== "COMPLETED" &&
    (method === "UPI_QR" || method === "CASH");
  const canFulfil = d.status === "CONFIRMED";
  const canCancel = d.status !== "CANCELLED" && d.status !== "REFUNDED";
  const busy = confirm.isPending || fulfill.isPending || cancel.isPending;

  return (
    <View style={styles.detail}>
      {/* Items */}
      {d.items.map((line) => (
        <View key={line.id} style={styles.lineRow}>
          <Text variant="small" color={colors.zinc300} style={{ flex: 1 }}>
            <Text variant="small" color={colors.emerald400} weight="600">
              {line.quantity}×
            </Text>{" "}
            {line.name}
          </Text>
          <Text variant="small" color={colors.zinc400}>
            {rupees(line.priceEachPaise * line.quantity)}
          </Text>
        </View>
      ))}

      <View style={styles.totalRow}>
        <Text variant="small" weight="600" color={colors.foreground}>
          Total
        </Text>
        <Text variant="bodyStrong" color={colors.emerald400}>
          {rupees(d.totalPaise)}
        </Text>
      </View>

      {/* Customer + payment meta */}
      <View style={styles.metaBlock}>
        {d.customer.email ? (
          <Text variant="tiny" color={colors.zinc500}>
            {d.customer.email}
          </Text>
        ) : null}
        <Text variant="tiny" color={colors.zinc500}>
          Payment: {paymentMethodLabel(method)} · {paymentStatus}
        </Text>
        {d.payment?.utrNumber ? (
          <Text variant="tiny" color={colors.zinc500}>
            UTR: {d.payment.utrNumber}
          </Text>
        ) : null}
        {d.cancelReason ? (
          <Text variant="tiny" color={colors.destructive}>
            Reason: {d.cancelReason}
          </Text>
        ) : null}
      </View>

      {/* Actions */}
      <View style={styles.actionRow}>
        {canConfirm ? (
          <ActionButton
            label={method === "UPI_QR" ? "Confirm UPI" : "Confirm cash"}
            tone="primary"
            icon={<CheckCircle2 size={13} color={colors.emerald400} />}
            disabled={busy}
            onPress={() => promptConfirm(method, (utr) => confirm.mutate(utr))}
          />
        ) : null}
        {canFulfil ? (
          <ActionButton
            label="Mark fulfilled"
            tone="primary"
            icon={<PackageCheck size={13} color={colors.emerald400} />}
            disabled={busy}
            onPress={() =>
              Alert.alert(
                "Mark fulfilled?",
                "Confirm the customer has collected this order.",
                [
                  { text: "Cancel", style: "cancel" },
                  { text: "Fulfil", onPress: () => fulfill.mutate() },
                ],
              )
            }
          />
        ) : null}
        {canCancel ? (
          <ActionButton
            label={d.status === "FULFILLED" ? "Refund / cancel" : "Cancel"}
            tone="danger"
            icon={<XCircle size={13} color={colors.destructive} />}
            disabled={busy}
            onPress={() => promptCancelReason((reason) => cancel.mutate(reason))}
          />
        ) : null}
      </View>
    </View>
  );
}

function promptConfirm(method: string, submit: (utr?: string) => void) {
  if (method !== "UPI_QR") {
    Alert.alert("Confirm cash payment?", "Mark this order CONFIRMED.", [
      { text: "Cancel", style: "cancel" },
      { text: "Confirm", onPress: () => submit(undefined) },
    ]);
    return;
  }
  // RN's Alert has no text input on Android. Offer "confirm without UTR"
  // — the web form treats UTR as optional-but-recommended too.
  Alert.alert(
    "Confirm UPI payment?",
    "Mark this order CONFIRMED. UTR can be added later from the web admin.",
    [
      { text: "Cancel", style: "cancel" },
      { text: "Confirm", onPress: () => submit(undefined) },
    ],
  );
}

function promptCancelReason(submit: (reason: string) => void) {
  Alert.alert("Cancel order?", "Stock is released unless already fulfilled.", [
    { text: "Keep order", style: "cancel" },
    { text: "Customer cancelled", onPress: () => submit("Customer cancelled") },
    { text: "Out of stock", onPress: () => submit("Out of stock") },
    { text: "Duplicate / error", onPress: () => submit("Duplicate / error") },
  ]);
}

function ActionButton({
  label,
  tone,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  tone: "primary" | "danger";
  icon: React.ReactNode;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionBtn,
        tone === "primary" ? styles.actionPrimary : styles.actionDanger,
        disabled && { opacity: 0.5 },
        pressed && { opacity: 0.7 },
      ]}
    >
      {icon}
      <Text
        variant="tiny"
        weight="600"
        color={tone === "primary" ? colors.emerald400 : colors.destructive}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  statRow: { flexDirection: "row", gap: spacing["2"] },
  statCard: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["3"],
    gap: 2,
  },
  chipRow: { gap: spacing["2"], paddingRight: spacing["2"] },
  chip: {
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["1.5"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  chipActive: {
    borderColor: colors.emerald400,
    backgroundColor: colors.emerald500_10,
  },
  list: { gap: spacing["2"] },
  orderCard: { overflow: "hidden" },
  orderHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    padding: spacing["3"],
  },
  orderTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  posBadge: {
    paddingHorizontal: spacing["1.5"],
    paddingVertical: 1,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc700,
    backgroundColor: colors.zinc800,
  },
  orderRight: { alignItems: "flex-end", gap: 2 },
  detail: {
    paddingHorizontal: spacing["3"],
    paddingBottom: spacing["3"],
    gap: spacing["2"],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing["3"],
  },
  lineRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing["2"],
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing["2"],
  },
  metaBlock: { gap: 2 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing["2"] },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    borderRadius: 999,
    borderWidth: 1,
  },
  actionPrimary: {
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_10,
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
  empty: {
    alignItems: "center",
    gap: spacing["2"],
    paddingVertical: spacing["8"],
  },
});
