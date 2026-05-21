import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronLeft,
  ChevronRight,
  Filter,
  Search,
  Sliders,
  X,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { colors, radius, spacing } from "../../theme";
import {
  adminRewardsApi,
  REWARD_TXN_TYPES,
  type AdminRewardTxnRow,
  type RewardTxnType,
} from "../../lib/admin-rewards";

/**
 * Mobile admin Transactions ledger.
 *
 * Mirrors the web /admin/rewards Transactions tab — filterable list
 * of every earn / redeem / revoke / expire / adjustment. Used for
 * reconciliation on the go. Heavy export (XLSX) stays web-only;
 * mobile shows the live list + aggregates.
 *
 * Filters live in local state (no URL) since RN doesn't have one.
 * Apply button triggers the fetch via the React Query keyed-on-filters
 * pattern so old responses don't clobber new ones.
 */

const PAGE_SIZE = 25;

const TYPE_LABELS: Record<RewardTxnType, string> = {
  EARNED_BOOKING: "Earn — booking",
  EARNED_BOOKING_REMAINDER: "Earn — booking remainder",
  EARNED_CAFE: "Earn — cafe",
  EARNED_SIGNUP: "Earn — signup",
  EARNED_REFERRAL: "Earn — referral",
  EARNED_BIRTHDAY: "Earn — birthday",
  EARNED_ADJUSTMENT: "Earn — admin grant",
  ADJUSTMENT_REFUND: "Refund — re-credit",
  REDEEMED_BOOKING: "Redeem — booking",
  REDEEMED_CAFE: "Redeem — cafe",
  REVOKED: "Revoke — clawback",
  EXPIRED: "Expired",
  ADJUSTMENT_DEBIT: "Debit — admin",
};

export function AdminRewardsTransactionsScreen() {
  // Applied filter state (drives the query) vs draft state (the form).
  const [appliedFilters, setAppliedFilters] = useState({
    query: "",
    fromDate: "",
    toDate: "",
    types: [] as RewardTxnType[],
    direction: "all" as "all" | "credit" | "debit",
    sourceId: "",
    actorQuery: "",
    page: 0,
  });
  const [draftQuery, setDraftQuery] = useState("");
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const [draftTypes, setDraftTypes] = useState<RewardTxnType[]>([]);
  const [draftDir, setDraftDir] = useState<"all" | "credit" | "debit">("all");
  const [draftSrc, setDraftSrc] = useState("");
  const [draftActor, setDraftActor] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // Sync drafts to applied state (for the Clear button).
  useEffect(() => {
    setDraftQuery(appliedFilters.query);
    setDraftFrom(appliedFilters.fromDate);
    setDraftTo(appliedFilters.toDate);
    setDraftTypes(appliedFilters.types);
    setDraftDir(appliedFilters.direction);
    setDraftSrc(appliedFilters.sourceId);
    setDraftActor(appliedFilters.actorQuery);
  }, [appliedFilters]);

  const ledgerQ = useQuery({
    queryKey: ["admin", "rewards", "ledger", appliedFilters],
    queryFn: () =>
      adminRewardsApi.transactions({
        query: appliedFilters.query || undefined,
        fromDate: appliedFilters.fromDate || undefined,
        toDate: appliedFilters.toDate || undefined,
        types:
          appliedFilters.types.length > 0
            ? appliedFilters.types
            : undefined,
        direction:
          appliedFilters.direction === "all"
            ? undefined
            : appliedFilters.direction,
        sourceId: appliedFilters.sourceId || undefined,
        actorQuery: appliedFilters.actorQuery || undefined,
        page: appliedFilters.page,
        pageSize: PAGE_SIZE,
      }),
  });

  function apply() {
    setAppliedFilters((prev) => ({
      query: draftQuery,
      fromDate: draftFrom,
      toDate: draftTo,
      types: draftTypes,
      direction: draftDir,
      sourceId: draftSrc,
      actorQuery: draftActor,
      page: 0, // reset pagination
    }));
    setShowFilters(false);
  }

  function clearAll() {
    setAppliedFilters({
      query: "",
      fromDate: "",
      toDate: "",
      types: [],
      direction: "all",
      sourceId: "",
      actorQuery: "",
      page: 0,
    });
    setShowFilters(false);
  }

  function setPage(n: number) {
    setAppliedFilters((prev) => ({ ...prev, page: n }));
  }

  function toggleType(t: RewardTxnType) {
    setDraftTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  }

  const data = ledgerQ.data;
  const aggs = data?.aggregates;
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  const activeFilterCount = useMemo(() => {
    const f = appliedFilters;
    let n = 0;
    if (f.query) n++;
    if (f.fromDate || f.toDate) n++;
    if (f.types.length > 0) n++;
    if (f.direction !== "all") n++;
    if (f.sourceId) n++;
    if (f.actorQuery) n++;
    return n;
  }, [appliedFilters]);

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* Toolbar */}
        <View style={styles.toolbar}>
          <Pressable
            onPress={() => setShowFilters((v) => !v)}
            style={({ pressed }) => [
              styles.filterBtn,
              showFilters && styles.filterBtnActive,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Sliders size={14} color={showFilters ? colors.emerald400 : colors.zinc300} />
            <Text style={[styles.filterBtnText, showFilters && { color: colors.emerald400 }]}>
              Filters
            </Text>
            {activeFilterCount > 0 && (
              <View style={styles.filterCountBadge}>
                <Text style={styles.filterCountText}>{activeFilterCount}</Text>
              </View>
            )}
          </Pressable>
          {activeFilterCount > 0 && (
            <Pressable
              onPress={clearAll}
              style={({ pressed }) => [
                styles.clearBtn,
                pressed && { opacity: 0.7 },
              ]}
            >
              <X size={12} color={colors.zinc400} />
              <Text style={styles.clearBtnText}>Clear</Text>
            </Pressable>
          )}
        </View>

        {/* Filter form */}
        {showFilters && (
          <View style={styles.filterCard}>
            <Field label="User (name / email / phone)">
              <Search size={14} color={colors.zinc500} style={styles.fieldIcon} />
              <TextInput
                value={draftQuery}
                onChangeText={setDraftQuery}
                placeholder="Search…"
                placeholderTextColor={colors.zinc600}
                style={[styles.input, { paddingLeft: 30 }]}
                autoCapitalize="none"
              />
            </Field>

            <View style={styles.fieldRow}>
              <View style={{ flex: 1 }}>
                <Field label="From (yyyy-mm-dd)">
                  <TextInput
                    value={draftFrom}
                    onChangeText={setDraftFrom}
                    placeholder="2026-05-01"
                    placeholderTextColor={colors.zinc600}
                    style={styles.input}
                    autoCapitalize="none"
                  />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="To">
                  <TextInput
                    value={draftTo}
                    onChangeText={setDraftTo}
                    placeholder="2026-05-31"
                    placeholderTextColor={colors.zinc600}
                    style={styles.input}
                    autoCapitalize="none"
                  />
                </Field>
              </View>
            </View>

            <View>
              <Text style={styles.fieldLabel}>Direction</Text>
              <View style={styles.segment}>
                {(["all", "credit", "debit"] as const).map((d) => (
                  <Pressable
                    key={d}
                    onPress={() => setDraftDir(d)}
                    style={[
                      styles.segmentBtn,
                      draftDir === d &&
                        (d === "credit"
                          ? styles.segmentBtnCredit
                          : d === "debit"
                            ? styles.segmentBtnDebit
                            : styles.segmentBtnAll),
                    ]}
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        draftDir === d && styles.segmentTextOn,
                      ]}
                    >
                      {d}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <Field label="Source ID (booking or cafe order)">
              <TextInput
                value={draftSrc}
                onChangeText={setDraftSrc}
                placeholder="exact ID match"
                placeholderTextColor={colors.zinc600}
                style={styles.input}
                autoCapitalize="none"
              />
            </Field>

            <Field label="Admin actor (username / email)">
              <TextInput
                value={draftActor}
                onChangeText={setDraftActor}
                placeholder="for ADJUSTMENT_* rows"
                placeholderTextColor={colors.zinc600}
                style={styles.input}
                autoCapitalize="none"
              />
            </Field>

            <Text style={styles.fieldLabel}>
              Types {draftTypes.length > 0 && `(${draftTypes.length})`}
            </Text>
            <View style={styles.typePills}>
              {REWARD_TXN_TYPES.map((t) => {
                const on = draftTypes.includes(t);
                return (
                  <Pressable
                    key={t}
                    onPress={() => toggleType(t)}
                    style={[styles.typePill, on && styles.typePillOn]}
                  >
                    <Text style={[styles.typePillText, on && styles.typePillTextOn]}>
                      {TYPE_LABELS[t]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              onPress={apply}
              style={({ pressed }) => [
                styles.applyBtn,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Filter size={14} color={colors.foreground} />
              <Text style={styles.applyBtnText}>Apply filters</Text>
            </Pressable>
          </View>
        )}

        {/* Aggregates */}
        {aggs && (
          <View style={styles.aggGrid}>
            <AggCard
              Icon={ArrowDownToLine}
              tone="credit"
              label="Credits"
              value={aggs.creditPoints.toLocaleString("en-IN")}
              sub={`${aggs.creditCount.toLocaleString("en-IN")} rows · ₹${Math.round(aggs.creditValuePaise / 100).toLocaleString("en-IN")}`}
            />
            <AggCard
              Icon={ArrowUpFromLine}
              tone="debit"
              label="Debits"
              value={aggs.debitPoints.toLocaleString("en-IN")}
              sub={`${aggs.debitCount.toLocaleString("en-IN")} rows · ₹${Math.round(aggs.debitValuePaise / 100).toLocaleString("en-IN")}`}
            />
            <AggCard
              Icon={ArrowDownToLine}
              tone={aggs.netPoints >= 0 ? "credit" : "debit"}
              label="Net"
              value={aggs.netPoints.toLocaleString("en-IN")}
              sub="credits − debits"
            />
            <AggCard
              Icon={ArrowDownToLine}
              tone="neutral"
              label="Matched"
              value={(data?.total ?? 0).toLocaleString("en-IN")}
              sub={
                data?.aggregateTruncated
                  ? `From first 10,000`
                  : `Page ${(data?.page ?? 0) + 1}/${Math.max(totalPages, 1)}`
              }
            />
          </View>
        )}

        {/* List */}
        {ledgerQ.isLoading ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : ledgerQ.isError ? (
          <Text style={styles.errorText}>
            {ledgerQ.error instanceof Error
              ? ledgerQ.error.message
              : "Couldn't load transactions."}
          </Text>
        ) : data && data.rows.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No transactions match</Text>
            <Text style={styles.emptySub}>
              Tweak the filters or clear them to see the full history.
            </Text>
          </View>
        ) : (
          <View style={styles.txnList}>
            {data?.rows.map((r) => <TxnRow key={r.id} row={r} />)}
          </View>
        )}

        {/* Pagination */}
        {data && data.total > PAGE_SIZE && (
          <View style={styles.pagination}>
            <Pressable
              disabled={data.page === 0}
              onPress={() => setPage(data.page - 1)}
              style={({ pressed }) => [
                styles.pageBtn,
                data.page === 0 && { opacity: 0.4 },
                pressed && { opacity: 0.7 },
              ]}
            >
              <ChevronLeft size={14} color={colors.zinc300} />
              <Text style={styles.pageBtnText}>Prev</Text>
            </Pressable>
            <Text style={styles.pageInfo}>
              {data.page * PAGE_SIZE + 1}–
              {Math.min((data.page + 1) * PAGE_SIZE, data.total)} of{" "}
              {data.total.toLocaleString("en-IN")}
            </Text>
            <Pressable
              disabled={data.page + 1 >= totalPages}
              onPress={() => setPage(data.page + 1)}
              style={({ pressed }) => [
                styles.pageBtn,
                data.page + 1 >= totalPages && { opacity: 0.4 },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={styles.pageBtnText}>Next</Text>
              <ChevronRight size={14} color={colors.zinc300} />
            </Pressable>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={{ position: "relative" }}>{children}</View>
    </View>
  );
}

function TxnRow({ row }: { row: AdminRewardTxnRow }) {
  const credit = row.points > 0;
  const when = new Date(row.createdAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const sourceLabel = row.bookingId
    ? `Booking ${row.bookingId.slice(-6)}`
    : row.cafeOrderId
      ? `Cafe ${row.cafeOrderId.slice(-6)}`
      : null;

  return (
    <View style={styles.txnRow}>
      <View style={styles.txnTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.txnUser}>{row.user.name ?? "—"}</Text>
          <Text style={styles.txnUserSub}>
            {row.user.phone ?? row.user.email ?? row.user.id.slice(-8)}
          </Text>
        </View>
        <Text
          style={[
            styles.txnPoints,
            credit ? { color: colors.emerald400 } : { color: "#fca5a5" },
          ]}
        >
          {credit ? "+" : ""}
          {row.points.toLocaleString("en-IN")}
        </Text>
      </View>
      <View style={styles.txnMeta}>
        <Text style={styles.txnType}>{TYPE_LABELS[row.type] ?? row.type}</Text>
        <Text style={styles.txnWhen}>{when}</Text>
      </View>
      {(sourceLabel || row.actor || row.reason) && (
        <View style={styles.txnFooter}>
          {sourceLabel && <Text style={styles.txnSource}>{sourceLabel}</Text>}
          {row.actor && (
            <Text style={styles.txnActor}>@{row.actor.username}</Text>
          )}
          {row.reason && (
            <Text style={styles.txnReason} numberOfLines={2}>
              {row.reason}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

function AggCard({
  Icon,
  tone,
  label,
  value,
  sub,
}: {
  Icon: typeof ArrowDownToLine;
  tone: "credit" | "debit" | "neutral";
  label: string;
  value: string;
  sub: string;
}) {
  const color =
    tone === "credit"
      ? colors.emerald400
      : tone === "debit"
        ? "#fca5a5"
        : colors.foreground;
  return (
    <View style={styles.aggCard}>
      <View style={styles.aggHead}>
        <Icon size={12} color={color} />
        <Text style={styles.aggLabel}>{label}</Text>
      </View>
      <Text style={[styles.aggValue, { color }]}>{value}</Text>
      <Text style={styles.aggSub}>{sub}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["6"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
  },
  filterBtnActive: {
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_10,
  },
  filterBtnText: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.zinc300,
  },
  filterCountBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: colors.emerald500,
    alignItems: "center",
    justifyContent: "center",
  },
  filterCountText: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.foreground,
  },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing["2"],
    paddingVertical: spacing["1"],
  },
  clearBtnText: {
    fontSize: 12,
    color: colors.zinc400,
  },
  filterCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: "rgba(24, 24, 27, 0.40)",
    padding: spacing["4"],
    gap: spacing["3"],
  },
  fieldRow: {
    flexDirection: "row",
    gap: spacing["3"],
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.zinc500,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  fieldIcon: {
    position: "absolute",
    left: 10,
    top: 12,
    zIndex: 1,
  },
  input: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: "#0a0a0b",
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    fontSize: 13,
    color: colors.foreground,
  },
  segment: {
    flexDirection: "row",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: "#0a0a0b",
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  segmentBtnAll: {
    backgroundColor: colors.zinc700,
  },
  segmentBtnCredit: {
    backgroundColor: colors.emerald500,
  },
  segmentBtnDebit: {
    backgroundColor: "#dc2626",
  },
  segmentText: {
    fontSize: 12,
    color: colors.zinc500,
    textTransform: "capitalize",
  },
  segmentTextOn: {
    color: colors.foreground,
    fontWeight: "600",
  },
  typePills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  typePill: {
    paddingHorizontal: spacing["3"],
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: "#0a0a0b",
  },
  typePillOn: {
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_10,
  },
  typePillText: {
    fontSize: 11,
    color: colors.zinc400,
  },
  typePillTextOn: {
    color: colors.emerald400,
    fontWeight: "600",
  },
  applyBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingVertical: spacing["3"],
  },
  applyBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.foreground,
  },
  aggGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["2"],
  },
  aggCard: {
    flexBasis: "48%",
    flexGrow: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["3"],
  },
  aggHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  aggLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.zinc500,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  aggValue: {
    marginTop: 4,
    fontSize: 18,
    fontWeight: "700",
  },
  aggSub: {
    fontSize: 10,
    color: colors.zinc600,
  },
  loadingBlock: {
    paddingVertical: spacing["8"],
    alignItems: "center",
  },
  errorText: {
    color: colors.destructive,
    paddingVertical: spacing["3"],
  },
  emptyCard: {
    alignItems: "center",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    borderStyle: "dashed",
    backgroundColor: "rgba(24, 24, 27, 0.30)",
    paddingVertical: spacing["6"],
    paddingHorizontal: spacing["4"],
    gap: 4,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.foreground,
  },
  emptySub: {
    fontSize: 12,
    color: colors.zinc500,
    textAlign: "center",
  },
  txnList: {
    gap: spacing["2"],
  },
  txnRow: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["3"],
    gap: 6,
  },
  txnTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
  },
  txnUser: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  txnUserSub: {
    fontSize: 11,
    color: colors.zinc500,
  },
  txnPoints: {
    fontSize: 16,
    fontWeight: "700",
  },
  txnMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing["3"],
  },
  txnType: {
    fontSize: 12,
    color: colors.zinc300,
  },
  txnWhen: {
    fontSize: 11,
    color: colors.zinc500,
  },
  txnFooter: {
    gap: 2,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.zinc800,
  },
  txnSource: {
    fontSize: 11,
    color: colors.zinc400,
  },
  txnActor: {
    fontSize: 11,
    color: colors.zinc400,
  },
  txnReason: {
    fontSize: 11,
    color: colors.zinc500,
    fontStyle: "italic",
  },
  pagination: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing["2"],
  },
  pageBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    paddingHorizontal: spacing["3"],
    paddingVertical: 6,
  },
  pageBtnText: {
    fontSize: 12,
    color: colors.zinc300,
  },
  pageInfo: {
    fontSize: 11,
    color: colors.zinc500,
  },
});
