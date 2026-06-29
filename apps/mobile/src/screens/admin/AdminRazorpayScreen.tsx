import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View, Pressable } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  Clock,
  IndianRupee,
  TrendingUp,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import { formatRupees } from "../../lib/format";
import {
  adminRazorpayApi,
  type AdminRazorpayOverview,
  type RazorpayTxn,
  type RazorpayTxnType,
} from "../../lib/admin-razorpay";

/** Razorpay amounts arrive in PAISE — divide by 100 before formatting. */
function paiseToRupees(paise: unknown): string {
  return formatRupees(Math.round(Number(paise) || 0) / 100);
}

function fmtDate(unixSeconds: unknown): string {
  const n = Number(unixSeconds);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return new Date(n * 1000).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtDateTime(unixSeconds: unknown): string {
  const n = Number(unixSeconds);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return new Date(n * 1000).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortId(id: unknown): string {
  const s = String(id ?? "");
  return s.length > 20 ? `${s.slice(0, 20)}…` : s || "—";
}

const STATUS_COLOR: Record<string, { fg: string; bg: string }> = {
  captured: { fg: colors.emerald400, bg: colors.emerald500_20 },
  paid: { fg: colors.emerald400, bg: colors.emerald500_20 },
  processed: { fg: colors.emerald400, bg: colors.emerald500_20 },
  created: { fg: colors.zinc300, bg: colors.zinc800 },
  authorized: { fg: colors.yellow400, bg: colors.yellow500_10 },
  attempted: { fg: colors.yellow400, bg: colors.yellow500_10 },
  refunded: { fg: colors.destructive_300, bg: colors.destructive_10 },
  failed: { fg: colors.destructive, bg: colors.destructive_10 },
};

function StatusBadge({ status }: { status: unknown }) {
  const s = String(status ?? "");
  const c = STATUS_COLOR[s] ?? { fg: colors.zinc400, bg: colors.zinc800 };
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text variant="tiny" weight="600" color={c.fg}>
        {s || "—"}
      </Text>
    </View>
  );
}

const KPIS: {
  key: keyof Pick<
    AdminRazorpayOverview,
    "totalCollected" | "totalRefunded" | "netRevenue" | "pendingSettlements"
  >;
  label: string;
  icon: typeof IndianRupee;
  color: string;
}[] = [
  { key: "totalCollected", label: "Total Collected", icon: IndianRupee, color: colors.emerald400 },
  { key: "totalRefunded", label: "Total Refunded", icon: ArrowDownLeft, color: colors.destructive },
  { key: "netRevenue", label: "Net Revenue", icon: TrendingUp, color: colors.foreground },
  { key: "pendingSettlements", label: "Pending Settlements", icon: Clock, color: colors.yellow400 },
];

const TABS: { key: "overview" | RazorpayTxnType; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "payments", label: "Payments" },
  { key: "orders", label: "Orders" },
  { key: "refunds", label: "Refunds" },
  { key: "settlements", label: "Settlements" },
  { key: "disputes", label: "Disputes" },
];

export function AdminRazorpayScreen() {
  const [tab, setTab] = useState<"overview" | RazorpayTxnType>("overview");

  return (
    <Screen padded={false}>
      <View style={styles.tabBarWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabBar}
        >
          {TABS.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[styles.tab, tab === t.key && styles.tabActive]}
            >
              <Text
                variant="small"
                weight="600"
                color={tab === t.key ? colors.emerald400 : colors.zinc400}
              >
                {t.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {tab === "overview" ? <OverviewTab /> : <TransactionsTab type={tab} />}
    </Screen>
  );
}

// --- Overview ---

function OverviewTab() {
  const query = useQuery({
    queryKey: ["admin", "razorpay-overview"],
    queryFn: () => adminRazorpayApi.overview(),
  });

  const overview = query.data?.overview;
  const methods = overview
    ? Object.entries(overview.paymentMethodBreakdown).sort((a, b) => b[1] - a[1])
    : [];
  const methodMax = methods.reduce((m, [, v]) => Math.max(m, v), 0);

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching && !query.isLoading}
          onRefresh={() => void query.refetch()}
          tintColor={colors.zinc400}
        />
      }
    >
      <Text variant="tiny" color={colors.zinc500} style={styles.caption}>
        Last 100 transactions · past 30 days
      </Text>

      {query.isLoading ? (
        <View style={styles.kpiGrid}>
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} style={styles.kpiCard}>
              <Skeleton width={28} height={28} />
              <Skeleton width="80%" height={20} />
              <Skeleton width="60%" height={12} />
            </Card>
          ))}
        </View>
      ) : query.isError ? (
        <Card style={styles.card}>
          <Text variant="small" color={colors.destructive}>
            {query.error instanceof Error
              ? query.error.message
              : "Couldn't load the Razorpay overview."}
          </Text>
        </Card>
      ) : overview?.error ? (
        <Card style={styles.card}>
          <Text variant="small" color={colors.destructive}>
            {overview.error}
          </Text>
        </Card>
      ) : overview ? (
        <>
          <View style={styles.kpiGrid}>
            {KPIS.map((kpi) => {
              const Icon = kpi.icon;
              return (
                <Card key={kpi.key} style={styles.kpiCard}>
                  <Icon size={20} color={kpi.color} />
                  <Text variant="title" weight="700" color={colors.foreground}>
                    {paiseToRupees(overview[kpi.key])}
                  </Text>
                  <Text variant="tiny" color={colors.zinc500}>
                    {kpi.label}
                  </Text>
                </Card>
              );
            })}
          </View>

          <Text variant="tiny" color={colors.zinc500} style={styles.section}>
            PAYMENT METHODS
          </Text>
          <Card style={styles.card}>
            {methods.length === 0 ? (
              <Text variant="small" color={colors.zinc500}>
                No captured payments in this window.
              </Text>
            ) : (
              methods.map(([m, amount]) => (
                <View key={m} style={styles.methodRow}>
                  <View style={styles.methodHead}>
                    <Text variant="small" weight="500" color={colors.foreground}>
                      {m}
                    </Text>
                    <Text variant="small" color={colors.zinc400}>
                      {paiseToRupees(amount)}
                    </Text>
                  </View>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        { width: `${methodMax > 0 ? (amount / methodMax) * 100 : 0}%` },
                      ]}
                    />
                  </View>
                </View>
              ))
            )}
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

// --- Transactions (drill-down lists) ---

function TransactionsTab({ type }: { type: RazorpayTxnType }) {
  const [page, setPage] = useState(1);
  // Disputes don't accept date filters (mirrors the web action).
  const supportsDates = type !== "disputes";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Applied filters — only updated on "Apply" so typing doesn't refetch.
  const [applied, setApplied] = useState<{ from?: string; to?: string }>({});

  const query = useQuery({
    queryKey: ["admin", "razorpay-txn", type, page, applied.from, applied.to],
    queryFn: () =>
      adminRazorpayApi.transactions({
        type,
        page,
        from: applied.from,
        to: applied.to,
      }),
  });

  const data = query.data;
  const items = data?.items ?? [];

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching && !query.isLoading}
          onRefresh={() => void query.refetch()}
          tintColor={colors.zinc400}
        />
      }
    >
      {supportsDates ? (
        <Card style={styles.filterCard}>
          <View style={styles.twoCol}>
            <View style={{ flex: 1 }}>
              <Input label="From (YYYY-MM-DD)" placeholder="2026-01-01" value={from} onChangeText={setFrom} />
            </View>
            <View style={{ flex: 1 }}>
              <Input label="To (YYYY-MM-DD)" placeholder="2026-01-31" value={to} onChangeText={setTo} />
            </View>
          </View>
          <Button
            label="Apply filter"
            variant="secondary"
            size="sm"
            onPress={() => {
              setPage(1);
              setApplied({ from: from || undefined, to: to || undefined });
            }}
            loading={query.isFetching && !query.isLoading}
          />
        </Card>
      ) : null}

      {query.isLoading ? (
        <View style={{ gap: spacing["3"] }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height={72} />
          ))}
        </View>
      ) : query.isError ? (
        <Card style={styles.card}>
          <Text variant="small" color={colors.destructive}>
            {query.error instanceof Error ? query.error.message : `Couldn't load ${type}.`}
          </Text>
        </Card>
      ) : data?.error ? (
        <Card style={styles.card}>
          <Text variant="small" color={colors.destructive}>
            {data.error}
          </Text>
        </Card>
      ) : items.length === 0 ? (
        <Card style={styles.card}>
          <Text variant="small" color={colors.zinc500}>
            No {type} found.
          </Text>
        </Card>
      ) : (
        <View style={{ gap: spacing["3"] }}>
          {items.map((row, i) => (
            <TxnCard key={(row.id as string) ?? String(i)} type={type} row={row} />
          ))}
        </View>
      )}

      {data && data.totalPages > 1 ? (
        <View style={styles.pager}>
          <Button
            label="Prev"
            variant="secondary"
            size="sm"
            disabled={page <= 1 || query.isFetching}
            onPress={() => setPage((p) => Math.max(1, p - 1))}
          />
          <Text variant="small" color={colors.zinc400}>
            Page {data.page} of {data.totalPages}
          </Text>
          <Button
            label="Next"
            variant="secondary"
            size="sm"
            disabled={page >= data.totalPages || query.isFetching}
            onPress={() => setPage((p) => p + 1)}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text variant="tiny" color={colors.zinc500}>
        {label}
      </Text>
      {typeof value === "string" || typeof value === "number" ? (
        <Text variant="small" color={colors.zinc300}>
          {value}
        </Text>
      ) : (
        value
      )}
    </View>
  );
}

function TxnCard({ type, row }: { type: RazorpayTxnType; row: RazorpayTxn }) {
  return (
    <Card style={styles.txnCard}>
      <View style={styles.txnHead}>
        <Text variant="tiny" color={colors.zinc500} style={styles.mono}>
          {shortId(row.id)}
        </Text>
        {row.status != null ? <StatusBadge status={row.status} /> : null}
      </View>

      <View style={styles.txnGrid}>
        {type === "payments" ? (
          <>
            <Field label="Amount" value={paiseToRupees(row.amount)} />
            <Field label="Method" value={String(row.method ?? "—")} />
            <Field label="Email" value={String(row.email ?? "—")} />
            <Field label="Date" value={fmtDateTime(row.created_at)} />
          </>
        ) : null}

        {type === "orders" ? (
          <>
            <Field label="Amount" value={paiseToRupees(row.amount)} />
            <Field label="Paid" value={paiseToRupees(row.amount_paid)} />
            <Field label="Due" value={paiseToRupees(row.amount_due)} />
            <Field label="Receipt" value={String(row.receipt ?? "—")} />
            <Field label="Date" value={fmtDate(row.created_at)} />
          </>
        ) : null}

        {type === "refunds" ? (
          <>
            <Field label="Amount" value={paiseToRupees(row.amount)} />
            <Field
              label="Payment"
              value={<Text variant="small" color={colors.zinc400} style={styles.mono}>{shortId(row.payment_id)}</Text>}
            />
            <Field label="Date" value={fmtDate(row.created_at)} />
          </>
        ) : null}

        {type === "settlements" ? (
          <>
            <Field label="Amount" value={paiseToRupees(row.amount)} />
            <Field label="Fees" value={paiseToRupees(row.fees)} />
            <Field label="Tax" value={paiseToRupees(row.tax)} />
            <Field label="UTR" value={String(row.utr ?? "—")} />
            <Field label="Date" value={fmtDate(row.created_at)} />
          </>
        ) : null}

        {type === "disputes" ? (
          <>
            <Field label="Amount" value={paiseToRupees(row.amount)} />
            <Field
              label="Payment"
              value={<Text variant="small" color={colors.zinc400} style={styles.mono}>{shortId(row.payment_id)}</Text>}
            />
            <Field label="Reason" value={String(row.reason_code ?? "—")} />
            <Field label="Date" value={fmtDate(row.created_at)} />
          </>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  tabBarWrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tabBar: {
    flexDirection: "row",
    gap: spacing["2"],
    paddingHorizontal: spacing["5"],
    paddingVertical: spacing["3"],
  },
  tab: {
    paddingVertical: spacing["2"],
    paddingHorizontal: spacing["3"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: colors.muted,
  },
  tabActive: { borderColor: colors.emerald400, backgroundColor: colors.emerald500_10 },
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["10"],
    gap: spacing["2"],
  },
  caption: { marginBottom: spacing["1"] },
  card: { padding: spacing["4"], gap: spacing["3"] },
  filterCard: { padding: spacing["4"], gap: spacing["2"], marginBottom: spacing["2"] },
  section: { letterSpacing: 1.2, fontWeight: "700", marginTop: spacing["3"] },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["3"],
  },
  kpiCard: {
    flexGrow: 1,
    flexBasis: "47%",
    padding: spacing["4"],
    gap: spacing["2"],
  },
  methodRow: { gap: spacing["1.5"] },
  methodHead: { flexDirection: "row", justifyContent: "space-between" },
  barTrack: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.zinc800,
    overflow: "hidden",
  },
  barFill: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.emerald400,
  },
  twoCol: { flexDirection: "row", gap: spacing["3"] },
  txnCard: { padding: spacing["4"], gap: spacing["3"] },
  txnHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing["2"],
  },
  txnGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["3"],
  },
  field: { flexBasis: "47%", flexGrow: 1, gap: 2 },
  mono: { fontFamily: "monospace" },
  badge: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
  },
  pager: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing["3"],
  },
});
