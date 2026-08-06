import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import { adminCafeApi, type CafeOrderStatus } from "../../lib/admin-cafe";
import { formatRupees } from "../../lib/format";

/**
 * Cafe order HISTORY. The app only had the live kanban, so staff could
 * work the open queue but never look up an order once it left the board
 * ("what did table 4 order yesterday?", "was that one refunded?").
 * Mirrors the web /admin/cafe-orders list: same filters, same 20-per-page
 * server action, so the two never disagree.
 */

const STATUS_FILTERS: { key: CafeOrderStatus | ""; label: string }[] = [
  { key: "", label: "All" },
  { key: "PENDING", label: "Pending" },
  { key: "PREPARING", label: "Preparing" },
  { key: "READY", label: "Ready" },
  { key: "COMPLETED", label: "Completed" },
  { key: "CANCELLED", label: "Cancelled" },
];

const STATUS_TONE: Record<string, string> = {
  PENDING: colors.yellow400,
  PREPARING: "#60a5fa",
  READY: colors.emerald400,
  COMPLETED: colors.zinc400,
  CANCELLED: "#f87171",
};

function istStamp(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

export function AdminCafeAllOrdersScreen() {
  const [status, setStatus] = useState<CafeOrderStatus | "">("");
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);

  const q = useQuery({
    queryKey: ["admin-cafe-history", status, applied, page],
    queryFn: () =>
      adminCafeApi.listOrders({ status, search: applied || undefined, page }),
  });

  const orders = q.data?.orders ?? [];
  const totalPages = q.data?.totalPages ?? 1;

  const header = useMemo(
    () => (
      <View style={styles.controls}>
        <View style={styles.searchRow}>
          <Search size={15} color={colors.zinc500} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={() => {
              setApplied(search.trim());
              setPage(1);
            }}
            returnKeyType="search"
            placeholder="Order number, name or phone"
            placeholderTextColor={colors.zinc500}
            style={styles.searchInput}
          />
          {search.length > 0 && (
            <Pressable
              onPress={() => {
                setSearch("");
                setApplied("");
                setPage(1);
              }}
              hitSlop={8}
            >
              <X size={15} color={colors.zinc500} />
            </Pressable>
          )}
        </View>

        <View style={styles.chipRow}>
          {STATUS_FILTERS.map((f) => {
            const on = status === f.key;
            return (
              <Pressable
                key={f.key || "all"}
                onPress={() => {
                  setStatus(f.key);
                  setPage(1);
                }}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text
                  variant="small"
                  weight={on ? "700" : "500"}
                  color={on ? "#022c22" : colors.zinc300}
                >
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {q.data ? (
          <Text variant="small" color={colors.zinc500}>
            {q.data.total} order{q.data.total === 1 ? "" : "s"}
          </Text>
        ) : null}
      </View>
    ),
    [search, status, q.data],
  );

  return (
    <Screen padded={false}>
      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={q.isRefetching}
            onRefresh={() => void q.refetch()}
            tintColor={colors.emerald400}
          />
        }
        ListEmptyComponent={
          q.isLoading ? (
            <View style={styles.loading}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={86} rounded="lg" />
              ))}
            </View>
          ) : (
            <Text variant="small" color={colors.zinc500} style={styles.empty}>
              No orders match these filters.
            </Text>
          )
        }
        renderItem={({ item: o }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <Text weight="700" color={colors.foreground}>
                #{o.orderNumber}
              </Text>
              <Text
                variant="small"
                weight="700"
                color={STATUS_TONE[o.status] ?? colors.zinc400}
              >
                {o.status}
              </Text>
            </View>
            <Text variant="small" color={colors.zinc400}>
              {o.user?.name || o.guestName || "Walk-in"}
              {o.user?.phone || o.guestPhone
                ? ` · ${o.user?.phone || o.guestPhone}`
                : ""}
            </Text>
            <Text variant="small" color={colors.zinc500}>
              {istStamp(o.createdAt)}
              {o.paymentMethod ? ` · ${o.paymentMethod}` : ""}
            </Text>
            <Text variant="small" color={colors.zinc300} style={styles.items}>
              {o.items.map((i) => `${i.quantity}× ${i.itemName}`).join(", ")}
            </Text>
            {o.note ? (
              <Text variant="small" color={colors.yellow400}>
                Note: {o.note}
              </Text>
            ) : null}
            <Text weight="700" color={colors.foreground}>
              {formatRupees(o.totalAmount)}
            </Text>
            {/* Part-paid orders: the balance matters more at the counter
                than the total does, so it gets its own line rather than
                hiding behind a tap into the order. */}
            {o.dueAmount && o.dueAmount > 0 ? (
              <Text variant="small" weight="700" color={colors.yellow400}>
                {formatRupees(o.dueAmount)} due
              </Text>
            ) : null}
          </View>
        )}
        ListFooterComponent={
          totalPages > 1 ? (
            <View style={styles.pager}>
              <Pressable
                disabled={page <= 1 || q.isFetching}
                onPress={() => setPage((p) => Math.max(1, p - 1))}
                style={[styles.pageBtn, page <= 1 && styles.pageBtnOff]}
              >
                <Text variant="small" color={colors.zinc300}>
                  Previous
                </Text>
              </Pressable>
              <Text variant="small" color={colors.zinc500}>
                {page} / {totalPages}
              </Text>
              <Pressable
                disabled={page >= totalPages || q.isFetching}
                onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
                style={[
                  styles.pageBtn,
                  page >= totalPages && styles.pageBtnOff,
                ]}
              >
                <Text variant="small" color={colors.zinc300}>
                  Next
                </Text>
              </Pressable>
            </View>
          ) : q.isFetching && orders.length > 0 ? (
            <ActivityIndicator
              color={colors.emerald400}
              style={styles.footerSpinner}
            />
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    padding: spacing["4"],
    gap: spacing["3"],
    paddingBottom: spacing["8"],
  },
  controls: {
    gap: spacing["3"],
    marginBottom: spacing["1"],
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    paddingHorizontal: spacing["3"],
    height: 42,
  },
  searchInput: {
    flex: 1,
    color: colors.foreground,
    fontSize: 14,
    padding: 0,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["2"],
  },
  chip: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.zinc700,
    paddingHorizontal: spacing["3"],
    paddingVertical: 6,
  },
  chipOn: {
    backgroundColor: colors.emerald400,
    borderColor: colors.emerald400,
  },
  card: {
    gap: 4,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["3"],
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  items: {
    marginTop: 2,
  },
  loading: {
    gap: spacing["3"],
  },
  empty: {
    textAlign: "center",
    marginTop: spacing["6"],
  },
  pager: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing["2"],
  },
  pageBtn: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc700,
    paddingHorizontal: spacing["4"],
    paddingVertical: spacing["2"],
  },
  pageBtnOff: {
    opacity: 0.4,
  },
  footerSpinner: {
    marginTop: spacing["3"],
  },
});
