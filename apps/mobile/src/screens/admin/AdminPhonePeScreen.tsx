import { useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock,
  Layers,
  TrendingUp,
  XCircle,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import { formatRupees } from "../../lib/format";
import {
  adminPhonePeApi,
  type PhonePeChannel,
  type PhonePeOverview,
  type PhonePeStatus,
  type PhonePeTxn,
} from "../../lib/admin-phonepe";

/** PhonePe amounts arrive in RUPEES already — no paise conversion. */
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// --- date range presets (chips) ---

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
}

const RANGES: { key: string; label: string; days: number | null }[] = [
  { key: "7d", label: "7d", days: 7 },
  { key: "30d", label: "30d", days: 30 },
  { key: "90d", label: "90d", days: 90 },
  { key: "all", label: "All", days: null },
];

const STATUS_FILTERS: {
  key: string;
  label: string;
  status?: PhonePeStatus;
}[] = [
  { key: "all", label: "All", status: undefined },
  { key: "COMPLETED", label: "Completed", status: "COMPLETED" },
  { key: "PENDING", label: "Pending", status: "PENDING" },
  { key: "FAILED", label: "Failed", status: "FAILED" },
];

const CHANNEL_FILTERS: {
  key: string;
  label: string;
  channel?: PhonePeChannel;
}[] = [
  { key: "all", label: "All", channel: undefined },
  { key: "STATIC", label: "Static QR", channel: "STATIC" },
  { key: "DQR", label: "Dynamic QR", channel: "DQR" },
];

// --- status badge ---

const STATUS_COLOR: Record<string, { fg: string; bg: string }> = {
  COMPLETED: { fg: colors.emerald400, bg: colors.emerald500_20 },
  PENDING: { fg: colors.yellow400, bg: colors.yellow500_10 },
  FAILED: { fg: colors.destructive, bg: colors.destructive_10 },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLOR[status] ?? { fg: colors.zinc400, bg: colors.zinc800 };
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text variant="tiny" weight="700" color={c.fg}>
        {status || "—"}
      </Text>
    </View>
  );
}

function TagBadge({ label, fg }: { label: string; fg: string }) {
  return (
    <View style={[styles.tagBadge, { borderColor: fg }]}>
      <Text variant="tiny" weight="600" color={fg}>
        {label}
      </Text>
    </View>
  );
}

function channelLabel(channel: PhonePeChannel): string {
  return channel === "DQR" ? "Dynamic QR" : "Static QR";
}

// --- KPI grid config ---

const KPIS: {
  key: keyof Pick<
    PhonePeOverview,
    "totalCount" | "completedCount" | "pendingCount" | "failedCount"
  >;
  label: string;
  icon: typeof Layers;
  color: string;
}[] = [
  { key: "totalCount", label: "Total Txns", icon: Layers, color: colors.foreground },
  { key: "completedCount", label: "Completed", icon: CheckCircle2, color: colors.emerald400 },
  { key: "pendingCount", label: "Pending", icon: Clock, color: colors.yellow400 },
  { key: "failedCount", label: "Failed", icon: XCircle, color: colors.destructive },
];

export function AdminPhonePeScreen() {
  const [rangeKey, setRangeKey] = useState("90d");
  const [statusKey, setStatusKey] = useState("all");
  const [channelKey, setChannelKey] = useState("all");
  const [page, setPage] = useState(1);

  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[2];
  const statusFilter = STATUS_FILTERS.find((s) => s.key === statusKey);
  const channelFilter = CHANNEL_FILTERS.find((c) => c.key === channelKey);
  const from = range.days != null ? isoDaysAgo(range.days) : undefined;

  const query = useQuery({
    queryKey: [
      "admin",
      "phonepe",
      rangeKey,
      statusFilter?.status ?? "all",
      channelFilter?.channel ?? "all",
      page,
    ],
    queryFn: () =>
      adminPhonePeApi.dashboard({
        from,
        status: statusFilter?.status,
        channel: channelFilter?.channel,
        page,
      }),
  });

  const overview = query.data?.overview;
  const txnPage = query.data?.transactions;
  const items = txnPage?.items ?? [];
  const notConfigured = overview ? overview.configured === false : false;

  function resetPageAnd(fn: () => void) {
    setPage(1);
    fn();
  }

  return (
    <Screen padded={false}>
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
          Live from PhonePe — static + Dynamic QR transactions.
          Standard-checkout payments not included.
        </Text>

        {/* Date range chips */}
        <ChipRow
          options={RANGES.map((r) => ({ key: r.key, label: r.label }))}
          active={rangeKey}
          onSelect={(k) => resetPageAnd(() => setRangeKey(k))}
        />

        {/* Overview */}
        {query.isLoading ? (
          <View style={styles.kpiGrid}>
            {[0, 1, 2, 3].map((i) => (
              <Card key={i} style={styles.kpiCard}>
                <Skeleton width={24} height={24} />
                <Skeleton width="70%" height={20} />
                <Skeleton width="50%" height={12} />
              </Card>
            ))}
          </View>
        ) : query.isError ? (
          <Card style={styles.card}>
            <Text variant="small" color={colors.destructive}>
              {query.error instanceof Error
                ? query.error.message
                : "Couldn't load the PhonePe dashboard."}
            </Text>
          </Card>
        ) : notConfigured ? (
          <Card style={styles.card}>
            <Text variant="small" color={colors.zinc400}>
              PhonePe QR reporting isn't configured (needs live DQR creds).
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
                      {overview[kpi.key]}
                    </Text>
                    <Text variant="tiny" color={colors.zinc500}>
                      {kpi.label}
                    </Text>
                  </Card>
                );
              })}
            </View>

            {/* Completed volume */}
            <View style={styles.kpiGrid}>
              <Card style={styles.kpiCard}>
                <TrendingUp size={20} color={colors.emerald400} />
                <Text variant="title" weight="700" color={colors.foreground}>
                  {formatRupees(overview.totalVolume)}
                </Text>
                <Text variant="tiny" color={colors.zinc500}>
                  Completed Volume
                </Text>
              </Card>
            </View>

            {/* Channel split */}
            <Text variant="tiny" color={colors.zinc500} style={styles.section}>
              VOLUME BY CHANNEL
            </Text>
            <Card style={styles.card}>
              <SplitRow label="Static QR" value={overview.byChannel.STATIC} />
              <SplitRow label="Dynamic QR" value={overview.byChannel.DQR} />
            </Card>

            {overview.truncated ? (
              <Text variant="tiny" color={colors.zinc500} style={styles.note}>
                Most recent transactions only — narrow the date range for older
                ones.
              </Text>
            ) : null}
          </>
        ) : null}

        {/* Transactions */}
        {notConfigured ? null : (
          <>
            <Text variant="tiny" color={colors.zinc500} style={styles.section}>
              TRANSACTIONS
            </Text>

            <ChipRow
              options={STATUS_FILTERS.map((s) => ({
                key: s.key,
                label: s.label,
              }))}
              active={statusKey}
              onSelect={(k) => resetPageAnd(() => setStatusKey(k))}
            />
            <ChipRow
              options={CHANNEL_FILTERS.map((c) => ({
                key: c.key,
                label: c.label,
              }))}
              active={channelKey}
              onSelect={(k) => resetPageAnd(() => setChannelKey(k))}
            />

            {query.isLoading ? (
              <View style={{ gap: spacing["3"] }}>
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} width="100%" height={96} />
                ))}
              </View>
            ) : items.length === 0 && !query.isError ? (
              <Card style={styles.card}>
                <Text variant="small" color={colors.zinc500}>
                  No PhonePe transactions in this window.
                </Text>
              </Card>
            ) : (
              <View style={{ gap: spacing["3"] }}>
                {items.map((txn) => (
                  <TxnCard key={txn.id} txn={txn} />
                ))}
              </View>
            )}

            {/* Pagination */}
            {txnPage && txnPage.totalPages > 1 ? (
              <View style={styles.pager}>
                <Button
                  label="Prev"
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1 || query.isFetching}
                  onPress={() => setPage((p) => Math.max(1, p - 1))}
                />
                <Text variant="small" color={colors.zinc400}>
                  Page {txnPage.page} of {txnPage.totalPages}
                </Text>
                <Button
                  label="Next"
                  variant="secondary"
                  size="sm"
                  disabled={page >= txnPage.totalPages || query.isFetching}
                  onPress={() => setPage((p) => p + 1)}
                />
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

// --- pieces ---

function ChipRow({
  options,
  active,
  onSelect,
}: {
  options: { key: string; label: string }[];
  active: string;
  onSelect: (key: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
    >
      {options.map((o) => {
        const on = o.key === active;
        return (
          <Pressable
            key={o.key}
            onPress={() => onSelect(o.key)}
            style={[styles.chip, on && styles.chipActive]}
          >
            <Text
              variant="small"
              weight="600"
              color={on ? colors.emerald400 : colors.zinc400}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function SplitRow({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.splitRow}>
      <Text variant="small" weight="500" color={colors.foreground}>
        {label}
      </Text>
      <Text variant="small" color={colors.zinc300}>
        {formatRupees(value)}
      </Text>
    </View>
  );
}

function TxnCard({ txn }: { txn: PhonePeTxn }) {
  return (
    <Card style={styles.txnCard}>
      <View style={styles.txnHead}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" color={colors.foreground}>
            {txn.customerName ?? "Guest"}
          </Text>
          {txn.customerPhone ? (
            <Text variant="tiny" color={colors.zinc500}>
              {txn.customerPhone}
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <Text variant="bodyStrong" weight="700" color={colors.foreground}>
            {formatRupees(txn.amount)}
          </Text>
          <StatusBadge status={txn.status} />
        </View>
      </View>

      <View style={styles.txnMeta}>
        <TagBadge label={channelLabel(txn.channel)} fg={colors.zinc400} />
        <Text variant="tiny" color={colors.zinc500}>
          {fmtDateTime(txn.createdAt)}
        </Text>
      </View>

      {txn.merchantTxnId ? (
        <Text variant="tiny" color={colors.zinc600}>
          Txn: {txn.merchantTxnId}
        </Text>
      ) : null}
      {txn.providerReferenceId ? (
        <Text variant="tiny" color={colors.zinc600}>
          Ref: {txn.providerReferenceId}
        </Text>
      ) : null}
      {txn.utr ? (
        <Text variant="tiny" color={colors.zinc600}>
          UTR: {txn.utr}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["10"],
    gap: spacing["2"],
  },
  caption: { marginBottom: spacing["2"], lineHeight: 16 },
  note: { marginTop: spacing["1"], lineHeight: 16 },
  card: { padding: spacing["4"], gap: spacing["3"] },
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
  chipRow: {
    flexDirection: "row",
    gap: spacing["2"],
    paddingVertical: spacing["2"],
  },
  chip: {
    paddingVertical: spacing["1.5"],
    paddingHorizontal: spacing["3"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: colors.muted,
  },
  chipActive: {
    borderColor: colors.emerald400,
    backgroundColor: colors.emerald500_10,
  },
  splitRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  txnCard: { padding: spacing["4"], gap: spacing["3"] },
  txnHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing["3"],
  },
  txnMeta: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing["2"],
  },
  badge: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
  },
  tagBadge: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pager: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing["3"],
  },
});
