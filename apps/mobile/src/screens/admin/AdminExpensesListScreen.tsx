import { useMemo, useState } from "react";
import {
  Alert,
  Modal,
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  IndianRupee,
  Lock,
  Plus,
  Receipt,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { ExpenseFormBody } from "../../components/admin/ExpenseFormBody";
import { colors, radius, spacing } from "../../theme";
import {
  adminExpensesApi,
  type AdminExpense,
  type AdminExpenseContributions,
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
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  // RUNNING-only: the add (+) flow opens an in-place bottom sheet
  // instead of pushing the form screen. Mounted on demand so the form
  // starts fresh every time (mirrors the DqrCheckout sheet pattern).
  const [sheetOpen, setSheetOpen] = useState(false);

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

  // Who fronted the money, and what the venture owes them. Running only:
  // the General module is read-only and nobody is reimbursed out of it.
  const contributions = useQuery({
    queryKey: [
      "admin-expense-contributions",
      moduleParam ?? "GENERAL",
      search.trim(),
    ],
    queryFn: () =>
      adminExpensesApi.contributions({
        module: moduleParam,
        search: search.trim() || undefined,
      }),
    enabled: isRunning,
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

        {/* Who paid out of pocket — the figure the venture transfers. */}
        {isRunning && contributions.data ? (
          <ContributionsCard data={contributions.data} />
        ) : null}

        {/* Quick actions */}
        <View style={styles.actionRow}>
          {/* GENERAL is READ-ONLY (2026-07-03): no new entries - new spend
              goes to Running Expenses. Server actions enforce this too. */}
          {isRunning ? (
            <Pressable
              onPress={() => setSheetOpen(true)}
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
          ) : (
            <View style={[styles.actionBtn, styles.actionNeutral]}>
              <Lock size={14} color={"#fbbf24"} />
              <Text variant="small" color={"#fbbf24"} weight="600">
                Read-only
              </Text>
            </View>
          )}
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
            placeholder={
              // RUNNING rows carry no vendor, so don't advertise it.
              isRunning
                ? "Search description, note"
                : "Search description, vendor, note"
            }
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
            {/* GENERAL is READ-ONLY: rows are view-only, no edit/delete. */}
            {list.data!.rows.map((e) => (
              <ExpenseRow key={e.id} expense={e} isDeleting={false} />
            ))}
          </View>
        )}
      </ScrollView>

      {/* RUNNING create → bottom sheet (chrome mirrors DqrCheckout).
          Mounted only while open so each add starts with a blank form;
          onRequestClose covers the Android back button. */}
      {isRunning && sheetOpen ? (
        <Modal
          transparent
          animationType="slide"
          visible
          onRequestClose={() => setSheetOpen(false)}
        >
          <View style={styles.sheetOverlay}>
            <Pressable
              style={styles.sheetBackdrop}
              onPress={() => setSheetOpen(false)}
            />
            <View
              style={[
                styles.sheet,
                { paddingBottom: Math.max(insets.bottom, spacing["4"]) },
              ]}
            >
              <View style={styles.sheetHeader}>
                <Text variant="bodyStrong" style={styles.sheetTitle}>
                  New running expense
                </Text>
                <Pressable
                  onPress={() => setSheetOpen(false)}
                  hitSlop={8}
                  style={styles.sheetClose}
                >
                  <X size={20} color={colors.zinc500} />
                </Pressable>
              </View>
              <View style={styles.sheetDivider} />
              <ExpenseFormBody
                module="RUNNING"
                showVendor={false}
                showTitle={false}
                onSaved={() => {
                  setSheetOpen(false);
                  void list.refetch();
                }}
                onCancel={() => setSheetOpen(false)}
              />
            </View>
          </View>
        </Modal>
      ) : null}
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
  // Both optional: the GENERAL tab is READ-ONLY (2026-07-03) - rows are
  // not tappable and have no delete affordance there.
  onPress?: () => void;
  onDelete?: () => void;
  isDeleting: boolean;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        style={({ pressed }) => [
          styles.rowMain,
          pressed && !!onPress && { opacity: 0.7 },
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
          {onPress ? <ChevronRight size={14} color={colors.zinc700} /> : null}
        </View>
      </Pressable>
      {onDelete ? (
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
      ) : null}
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

/**
 * Compact version of the web Running Expenses contributions panel.
 *
 * Per person over the current filter, then per month. Spend the venture
 * paid from its own account is listed apart and never folded into an
 * amount-to-transfer: it is already settled, and including it would
 * propose paying the company back to itself.
 *
 * The figures are the server's, computed over every matching row — not
 * summed from the 50 the list is showing, which would silently
 * under-report any month that spills onto a second page.
 */
function ContributionsCard({ data }: { data: AdminExpenseContributions }) {
  const [open, setOpen] = useState(false);
  if (data.entryCount === 0) return null;

  // Newest month first from the server; that is the one being settled.
  const shown = open ? data.months : data.months.slice(0, 1);

  return (
    <View style={styles.contribCard}>
      <View style={styles.contribHead}>
        <Users size={14} color={colors.emerald400} />
        <Text variant="small" color={colors.zinc300}>
          To reimburse
        </Text>
        <View style={{ flex: 1 }} />
        <Text variant="bodyStrong" color={colors.emerald400}>
          {formatRupees(data.reimbursableTotal)}
        </Text>
      </View>

      {data.byPerson.length === 0 ? (
        <Text variant="small" color={colors.zinc500}>
          Everything here was paid by the venture directly — nothing to
          transfer.
        </Text>
      ) : (
        <View style={styles.contribPeople}>
          {data.byPerson.map((p) => (
            <View key={p.person} style={styles.contribPerson}>
              <Text variant="small" color={colors.zinc400}>
                {p.person}
              </Text>
              <Text variant="bodyStrong" color={colors.foreground}>
                {formatRupees(p.amount)}
              </Text>
            </View>
          ))}
        </View>
      )}

      {data.venture.length > 0 ? (
        <Text variant="small" color={colors.zinc600}>
          {formatRupees(data.ventureTotal)} paid directly by{" "}
          {data.venture.map((v) => v.person).join(", ")} — owed to nobody.
        </Text>
      ) : null}

      {data.months.length > 0 ? (
        <View style={styles.contribMonths}>
          {shown.map((m) => (
            <View key={m.month} style={styles.contribMonthRow}>
              <Text variant="small" color={colors.zinc400}>
                {monthKeyLabel(m.month)}
              </Text>
              <View style={{ flex: 1 }} />
              <Text variant="small" color={colors.emerald400}>
                {formatRupees(m.reimbursable)}
              </Text>
            </View>
          ))}
          {data.months.length > 1 ? (
            <Pressable onPress={() => setOpen((o) => !o)} hitSlop={6}>
              <Text variant="small" color={colors.zinc500}>
                {open ? "Show less" : `Show all ${data.months.length} months`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** "October 2026" from a "2026-10" key. */
function monthKeyLabel(key: string): string {
  const [y, m] = key.split("-");
  return new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleDateString(
    "en-IN",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );
}

const styles = StyleSheet.create({
  contribCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    padding: spacing["3"],
    gap: spacing["2"],
  },
  contribHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  contribPeople: { gap: 4 },
  contribPerson: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  contribMonths: {
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing["2"],
  },
  contribMonthRow: { flexDirection: "row", alignItems: "center" },
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
  // ── RUNNING add sheet — same chrome as the DqrCheckout bottom sheet ──
  sheetOverlay: { flex: 1, justifyContent: "flex-end" },
  sheetBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    backgroundColor: "#18181b", // zinc-900 sheet surface
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.zinc800,
    maxHeight: "85%",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["3"],
  },
  sheetTitle: { flex: 1 },
  sheetClose: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.zinc800,
  },
});
