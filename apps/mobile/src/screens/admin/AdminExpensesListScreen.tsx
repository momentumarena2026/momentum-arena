import { useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  IndianRupee,
  Plus,
  Receipt,
  Search,
  Trash2,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminExpensesApi,
  type AdminExpense,
} from "../../lib/admin-expenses";
import { AdminApiError } from "../../lib/admin-api";
import { formatRupees } from "../../lib/format";
import type { AdminExpensesStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<
  AdminExpensesStackParamList,
  "AdminExpensesList"
>;
type Rt = RouteProp<AdminExpensesStackParamList, "AdminExpensesList">;

/**
 * Mirrors the web /admin/expenses page list view. Filters collapsed
 * to "search" — the floor staff workflow on mobile is "find a recent
 * expense and edit / delete", not deep slicing. Power filters
 * (paymentType, doneBy, etc.) live on the analytics screen instead,
 * because that's where slicing actually pays off.
 *
 * The `module` route param flips this same screen into the Running
 * Expenses ledger: every data call is scoped server-side, react-query
 * keys fork so GENERAL/RUNNING never share caches, and the flat list
 * becomes month-collapsible groups (recurring costs are reviewed
 * month-by-month, not entry-by-entry).
 */
export function AdminExpensesListScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const moduleParam = route.params?.module;
  const isRunning = moduleParam === "RUNNING";

  const list = useQuery({
    queryKey: ["admin-expenses", moduleParam ?? "GENERAL", search.trim()],
    queryFn: () =>
      adminExpensesApi.list({
        search: search.trim() || undefined,
        pageSize: 50,
        module: moduleParam,
      }),
    refetchOnWindowFocus: false,
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminExpensesApi.remove(id),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["admin-expenses"] }),
    onError: (err) =>
      Alert.alert(
        "Couldn't delete",
        err instanceof AdminApiError ? err.message : "Try again.",
      ),
  });

  const refreshing =
    (list.isFetching && !list.isLoading) || list.isRefetching;

  const totalLabel = useMemo(
    () =>
      list.data
        ? `${list.data.total} entries · ${formatRupees(list.data.totalAmount)}`
        : "…",
    [list.data],
  );

  // ── RUNNING module: month-collapsible grouping ──
  // Rows arrive date-desc from the server, so the first group is the
  // most recent month. Only that one starts expanded; taps override.
  const monthGroups = useMemo<MonthGroup[]>(() => {
    if (!isRunning || !list.data) return [];
    const groups: MonthGroup[] = [];
    const byLabel = new Map<string, MonthGroup>();
    for (const e of list.data.rows) {
      const label = monthLabel(e.date);
      let g = byLabel.get(label);
      if (!g) {
        g = { label, total: 0, rows: [] };
        byLabel.set(label, g);
        groups.push(g);
      }
      g.total += e.amount;
      g.rows.push(e);
    }
    return groups;
  }, [isRunning, list.data]);

  // Sparse override map — a month absent here falls back to its
  // default (index 0 expanded, the rest collapsed).
  const [monthOverrides, setMonthOverrides] = useState<
    Record<string, boolean>
  >({});

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void list.refetch()}
            tintColor={colors.yellow400}
          />
        }
      >
        {/* Hero summary */}
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <Receipt size={20} color={colors.yellow400} />
          </View>
          <View style={styles.heroBody}>
            <Text variant="bodyStrong">
              {isRunning ? "Running Expenses" : "Expenses"}
            </Text>
            <Text variant="small" color={colors.zinc500}>
              {totalLabel}
            </Text>
          </View>
        </View>

        {/* Quick actions */}
        <View style={styles.actionRow}>
          <Pressable
            onPress={() =>
              navigation.navigate("AdminExpenseForm", {
                module: moduleParam,
              })
            }
            style={({ pressed }) => [
              styles.actionBtn,
              styles.actionPrimary,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Plus size={14} color={colors.yellow400} />
            <Text variant="small" color={colors.yellow400} weight="600">
              Add expense
            </Text>
          </Pressable>
          <Pressable
            onPress={() =>
              navigation.navigate("AdminExpenseAnalytics", {
                module: moduleParam,
              })
            }
            style={({ pressed }) => [
              styles.actionBtn,
              styles.actionNeutral,
              pressed && { opacity: 0.7 },
            ]}
          >
            <BarChart3 size={14} color={colors.zinc300} />
            <Text variant="small" color={colors.zinc300} weight="600">
              Analytics
            </Text>
          </Pressable>
        </View>

        {/* Search */}
        <View style={styles.searchRow}>
          <Search size={14} color={colors.zinc500} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search description, vendor, note"
            placeholderTextColor={colors.zinc600}
            style={styles.searchInput}
          />
        </View>

        {list.isLoading ? (
          <ListSkeleton />
        ) : list.isError ? (
          <Pressable
            onPress={() => void list.refetch()}
            style={styles.errorBlock}
          >
            <Text variant="body" color={colors.destructive}>
              Couldn't load expenses. Tap to retry.
            </Text>
            <Text variant="tiny" color={colors.zinc500}>
              {list.error instanceof Error
                ? list.error.message
                : "Unknown error"}
            </Text>
          </Pressable>
        ) : list.data!.rows.length === 0 ? (
          <View style={styles.empty}>
            <IndianRupee size={28} color={colors.zinc500} />
            <Text variant="bodyStrong" color={colors.zinc300}>
              {isRunning ? "No running expenses" : "No expenses"}
            </Text>
            <Text variant="tiny" color={colors.zinc500} align="center">
              Tap "Add expense" above to record one.
            </Text>
          </View>
        ) : isRunning ? (
          // RUNNING: month-collapsible groups (most recent expanded).
          <View style={{ gap: spacing["2"] }}>
            {monthGroups.map((g, idx) => {
              const expanded = monthOverrides[g.label] ?? idx === 0;
              return (
                <View key={g.label} style={{ gap: spacing["2"] }}>
                  <Pressable
                    onPress={() =>
                      setMonthOverrides((prev) => ({
                        ...prev,
                        [g.label]: !expanded,
                      }))
                    }
                    style={({ pressed }) => [
                      styles.monthHeader,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="bodyStrong">{g.label}</Text>
                      <Text variant="tiny" color={colors.zinc500}>
                        {g.rows.length}{" "}
                        {g.rows.length === 1 ? "entry" : "entries"}
                      </Text>
                    </View>
                    <Text variant="bodyStrong" color={colors.emerald400}>
                      {formatRupees(g.total)}
                    </Text>
                    {expanded ? (
                      <ChevronDown size={16} color={colors.zinc500} />
                    ) : (
                      <ChevronRight size={16} color={colors.zinc500} />
                    )}
                  </Pressable>
                  {expanded
                    ? g.rows.map((e) => (
                        <ExpenseRow
                          key={e.id}
                          expense={e}
                          onPress={() =>
                            navigation.navigate("AdminExpenseForm", {
                              expenseId: e.id,
                              module: moduleParam,
                            })
                          }
                          onDelete={() =>
                            confirmDelete(e, () => remove.mutate(e.id))
                          }
                          isDeleting={
                            remove.isPending && remove.variables === e.id
                          }
                        />
                      ))
                    : null}
                </View>
              );
            })}
          </View>
        ) : (
          <View style={{ gap: spacing["2"] }}>
            {list.data!.rows.map((e) => (
              <ExpenseRow
                key={e.id}
                expense={e}
                onPress={() =>
                  navigation.navigate("AdminExpenseForm", {
                    expenseId: e.id,
                  })
                }
                onDelete={() =>
                  confirmDelete(e, () => remove.mutate(e.id))
                }
                isDeleting={
                  remove.isPending && remove.variables === e.id
                }
              />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function ExpenseRow({
  expense,
  onPress,
  onDelete,
  isDeleting,
}: {
  expense: AdminExpense;
  onPress: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.rowMain,
          pressed && { opacity: 0.7 },
        ]}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {expense.description}
          </Text>
          <Text variant="tiny" color={colors.zinc500} numberOfLines={1}>
            {expense.spentType} · {expense.toName}
          </Text>
          <View style={styles.rowMeta}>
            <Text variant="tiny" color={colors.zinc400}>
              {prettyDate(expense.date)}
            </Text>
            <Text variant="tiny" color={colors.zinc700}>
              ·
            </Text>
            <Text variant="tiny" color={colors.zinc500}>
              {expense.paymentType} · {expense.doneBy}
            </Text>
          </View>
        </View>
        <View style={styles.rowRight}>
          <Text variant="bodyStrong">{formatRupees(expense.amount)}</Text>
          <ChevronRight size={14} color={colors.zinc700} />
        </View>
      </Pressable>
      <Pressable
        onPress={onDelete}
        disabled={isDeleting}
        hitSlop={8}
        style={({ pressed }) => [
          styles.deleteBtn,
          isDeleting && { opacity: 0.5 },
          pressed && { opacity: 0.6 },
        ]}
      >
        <Trash2 size={14} color={colors.destructive} />
      </Pressable>
    </View>
  );
}

function ListSkeleton() {
  return (
    <View style={{ gap: spacing["2"] }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={styles.row}>
          <View style={{ flex: 1, gap: 4 }}>
            <Skeleton width="70%" height={14} />
            <Skeleton width="50%" height={11} />
            <Skeleton width="40%" height={11} />
          </View>
          <Skeleton width={60} height={14} />
        </View>
      ))}
    </View>
  );
}

function prettyDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

interface MonthGroup {
  /** "July 2026" — unique per month-year, doubles as the group key. */
  label: string;
  total: number;
  rows: AdminExpense[];
}

/** Calendar-month bucket label, IST — matches how prettyDate renders. */
function monthLabel(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

/** Shared delete confirm — used by both the flat and grouped lists. */
function confirmDelete(e: AdminExpense, onConfirm: () => void) {
  Alert.alert(
    "Delete expense?",
    `${e.description} (${formatRupees(e.amount)}) will be removed permanently.`,
    [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: onConfirm },
    ],
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  hero: {
    flexDirection: "row",
    gap: spacing["3"],
    padding: spacing["4"],
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: "rgba(250, 204, 21, 0.30)",
    backgroundColor: "rgba(250, 204, 21, 0.06)",
  },
  heroIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(250, 204, 21, 0.40)",
    backgroundColor: "rgba(250, 204, 21, 0.10)",
  },
  heroBody: { flex: 1, gap: spacing["1"] },
  actionRow: {
    flexDirection: "row",
    gap: spacing["2"],
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["1.5"],
    paddingVertical: spacing["2.5"],
    borderRadius: 8,
    borderWidth: 1,
  },
  actionPrimary: {
    borderColor: "rgba(250, 204, 21, 0.40)",
    backgroundColor: "rgba(250, 204, 21, 0.10)",
  },
  actionNeutral: {
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    borderWidth: 1,
    borderColor: colors.zinc800,
    borderRadius: 8,
    paddingHorizontal: spacing["3"],
    backgroundColor: colors.zinc900,
  },
  searchInput: {
    flex: 1,
    paddingVertical: spacing["2.5"],
    color: colors.foreground,
    fontSize: 14,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    padding: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  rowRight: {
    alignItems: "flex-end",
    gap: 2,
    flexDirection: "row",
  },
  rowMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
    flexWrap: "wrap",
  },
  deleteBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.30)",
    backgroundColor: "rgba(239, 68, 68, 0.10)",
  },
  // Month group header (RUNNING module). Emerald-tinted so the
  // pressable "section" rows read differently from expense rows.
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    padding: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(52, 211, 153, 0.25)",
    backgroundColor: "rgba(52, 211, 153, 0.06)",
  },
  empty: {
    alignItems: "center",
    gap: spacing["2"],
    padding: spacing["8"],
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
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
