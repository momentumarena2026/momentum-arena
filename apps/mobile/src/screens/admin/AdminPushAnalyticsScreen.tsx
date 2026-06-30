import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Bell,
  CheckCircle2,
  Send,
  Smartphone,
  Trash2,
  Users,
  XCircle,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import {
  LineChart,
  MultiLineChart,
  BarChart,
  DonutChart,
  ChartCard,
  CHART_COLORS,
} from "../../components/charts";
import { colors, radius, spacing } from "../../theme";
import {
  adminAnalyticsApi,
  type PushAnalyticsResponse,
} from "../../lib/admin-analytics";

/**
 * Read-only push analytics — mobile mirror of web
 * /admin/analytics/push, at full parity: every KPI tile, every chart,
 * the filter set, and the recent-dispatches list the web dashboard
 * renders.
 *
 * Controls drive a single fetch against /api/mobile/admin/analytics/push,
 * which returns the KPIs + ALL chart datasets + recent dispatches in one
 * payload:
 *   - Range chips (30d / 90d / All) → from/to ("All" sends none so the
 *     route defaults to earliest-dispatch → today = lifetime totals)
 *   - Source chips (Event / Broadcast / Test) → multi-select
 *   - Audience scope (All / Customer / Admin) → single-select
 *   - Kind chips (from the dispatched-kinds list) → multi-select
 *
 * KPIs (counts, no money): Sent / Delivered (+rate) / Failed / Dead
 * tokens pruned / Dispatches / Broadcasts + the device fleet (Reach /
 * Devices / Active / Admin).
 *
 * Charts (recharts on web → RN chart kit here):
 *   - Sends over time              → MultiLineChart (delivered vs failed)
 *   - By kind (attempted/delivered)→ horizontal BarChart
 *   - Dispatches by source         → DonutChart
 *   - New device registrations     → LineChart
 *   - Devices by platform          → DonutChart
 *   - Devices by app version       → horizontal BarChart
 *   - Recent dispatches            → list
 */
export function AdminPushAnalyticsScreen() {
  const [range, setRange] = useState<RangeKey>("ALL");
  const [sources, setSources] = useState<string[]>([]);
  const [scope, setScope] = useState<ScopeKey>("all");
  const [kinds, setKinds] = useState<string[]>([]);
  const { from, to } = useMemo(() => resolveRange(range), [range]);

  const query = useQuery({
    queryKey: [
      "admin-push-analytics",
      from ?? "ALL",
      to ?? "ALL",
      sources.join(","),
      scope,
      kinds.join(","),
    ],
    queryFn: () =>
      adminAnalyticsApi.push({
        from: from ?? undefined,
        to: to ?? undefined,
        sources: sources.length ? sources : undefined,
        scope,
        kinds: kinds.length ? kinds : undefined,
      }),
    refetchOnWindowFocus: false,
  });

  const refreshing = (query.isFetching && !query.isLoading) || query.isRefetching;
  const availableKinds = query.data?.kinds ?? [];

  const toggle = (
    list: string[],
    setList: (v: string[]) => void,
    value: string,
  ) =>
    setList(
      list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
    );

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void query.refetch()}
            tintColor={colors.yellow400}
          />
        }
      >
        {/* Date-range chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {RANGES.map((r) => (
            <Pressable
              key={r.value}
              onPress={() => setRange(r.value)}
              style={[styles.chip, range === r.value && styles.chipActive]}
            >
              <Text
                variant="tiny"
                color={range === r.value ? colors.yellow400 : colors.zinc300}
                weight="600"
              >
                {r.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Source filter — multi-select, mirrors web's Source chips. */}
        <FilterRow label="Source">
          {SOURCES.map((s) => (
            <Chip
              key={s}
              active={sources.includes(s)}
              onPress={() => toggle(sources, setSources, s)}
            >
              {titleCase(s)}
            </Chip>
          ))}
        </FilterRow>

        {/* Audience scope — single-select, mirrors web's scope chips. */}
        <FilterRow label="Audience scope">
          {SCOPES.map((s) => (
            <Chip key={s} active={scope === s} onPress={() => setScope(s)}>
              {titleCase(s)}
            </Chip>
          ))}
        </FilterRow>

        {/* Kind filter — multi-select, populated from dispatched kinds. */}
        {availableKinds.length > 0 ? (
          <FilterRow
            label={`Kind ${kinds.length > 0 ? `(${kinds.length})` : "(all)"}`}
          >
            {availableKinds.map((k) => (
              <Chip
                key={k}
                active={kinds.includes(k)}
                onPress={() => toggle(kinds, setKinds, k)}
              >
                {k}
              </Chip>
            ))}
            {kinds.length > 0 ? (
              <Pressable onPress={() => setKinds([])} style={styles.clearChip}>
                <Text variant="tiny" color={colors.zinc500} weight="600">
                  Clear
                </Text>
              </Pressable>
            ) : null}
          </FilterRow>
        ) : null}

        {query.isLoading ? (
          <LoadingState />
        ) : query.isError ? (
          <Pressable onPress={() => void query.refetch()} style={styles.errorBlock}>
            <Text variant="body" color={colors.destructive}>
              Couldn't load analytics. Tap to retry.
            </Text>
            <Text variant="tiny" color={colors.zinc500}>
              {query.error instanceof Error ? query.error.message : "Unknown error"}
            </Text>
          </Pressable>
        ) : query.data ? (
          <Body data={query.data} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function LoadingState() {
  return (
    <>
      <View style={styles.tileRow}>
        <Skeleton width="48%" height={64} rounded="lg" />
        <Skeleton width="48%" height={64} rounded="lg" />
      </View>
      <View style={styles.tileRow}>
        <Skeleton width="48%" height={64} rounded="lg" />
        <Skeleton width="48%" height={64} rounded="lg" />
      </View>
      <Skeleton width="100%" height={200} rounded="xl" />
      <Skeleton width="100%" height={200} rounded="xl" />
    </>
  );
}

function Body({ data }: { data: PushAnalyticsResponse }) {
  const t = data.analytics.totals;
  const fleet = data.analytics.fleet;

  // ── Sends over time → MultiLineChart (delivered vs failed) ──
  const sendsSeries = [
    {
      name: "Delivered",
      color: colors.emerald400,
      points: data.analytics.timeSeries.map((d) => ({
        x: shortDate(d.date),
        y: d.succeeded,
      })),
    },
    {
      name: "Failed",
      color: colors.destructive,
      points: data.analytics.timeSeries.map((d) => ({
        x: shortDate(d.date),
        y: d.failed,
      })),
    },
  ];

  // ── By kind → horizontal BarChart (attempted), delivered in subtext ──
  const kindBars = data.analytics.byKind.slice(0, 12).map((k, i) => ({
    label: k.kind,
    value: k.attempted,
    color: kindColor(k.kind, i),
  }));

  // ── Dispatches by source → DonutChart ──
  const sourceDonut = data.analytics.bySource
    .filter((s) => s.dispatches > 0)
    .map((s, i) => ({
      label: titleCase(s.source),
      value: s.dispatches,
      color: sourceColor(s.source, i),
    }));

  // ── New device registrations → LineChart ──
  const regPoints = fleet.registrations.map((r) => ({
    x: shortDate(r.date),
    y: r.count,
  }));

  // ── Devices by platform → DonutChart ──
  const platformDonut = [
    { label: "iOS", value: fleet.iosDevices, color: "#60a5fa" },
    { label: "Android", value: fleet.androidDevices, color: colors.emerald400 },
  ].filter((d) => d.value > 0);

  // ── Devices by app version → horizontal BarChart ──
  const versionBars = fleet.byAppVersion.slice(0, 10).map((v) => ({
    label: v.version,
    value: v.count,
    color: "#a78bfa",
  }));

  return (
    <>
      {/* ── KPI tiles ── */}
      <View style={styles.tileRow}>
        <Tile
          icon={<Send size={14} color={colors.zinc300} />}
          label="Sent (attempted)"
          value={n(t.attempted)}
        />
        <Tile
          icon={<CheckCircle2 size={14} color={colors.emerald400} />}
          label="Delivered"
          value={n(t.succeeded)}
          valueColor={colors.emerald400}
          sub={`${t.deliveryRate == null ? "—" : `${t.deliveryRate}%`} delivery rate`}
        />
      </View>
      <View style={styles.tileRow}>
        <Tile
          icon={<XCircle size={14} color={colors.destructive} />}
          label="Failed"
          value={n(t.failed)}
          valueColor={t.failed > 0 ? colors.destructive : colors.zinc400}
        />
        <Tile
          icon={<Trash2 size={14} color={colors.warning} />}
          label="Dead tokens pruned"
          value={n(t.cleanedUp)}
          valueColor={colors.warning}
          sub="uninstalled / rotated"
        />
      </View>
      <View style={styles.tileRow}>
        <Tile
          icon={<Send size={14} color={colors.yellow400} />}
          label="Dispatches"
          value={n(t.dispatches)}
        />
        <Tile
          icon={<Bell size={14} color={"#a78bfa"} />}
          label="Broadcasts"
          value={n(t.broadcasts)}
          valueColor={"#a78bfa"}
        />
      </View>

      {/* ── Device fleet ── */}
      <View style={styles.tileRow}>
        <Tile
          icon={<Users size={14} color={colors.zinc300} />}
          label="Reach (users)"
          value={n(fleet.reachUsers)}
          sub="users with ≥1 device"
        />
        <Tile
          icon={<Smartphone size={14} color={colors.zinc300} />}
          label="Devices"
          value={n(fleet.totalDevices)}
          sub={`${n(fleet.iosDevices)} iOS · ${n(fleet.androidDevices)} Android`}
        />
      </View>
      <View style={styles.tileRow}>
        <Tile
          icon={<Smartphone size={14} color={colors.emerald400} />}
          label="Active devices"
          value={n(fleet.activeDevices)}
          valueColor={colors.emerald400}
          sub={`${n(fleet.staleDevices)} stale (30d+)`}
        />
        <Tile
          icon={<Smartphone size={14} color={colors.yellow400} />}
          label="Admin devices"
          value={n(fleet.adminDevices)}
          sub="staff fleet"
        />
      </View>

      {/* ── Sends over time ── */}
      <ChartCard title="Sends Over Time" subtitle="Delivered vs failed per day">
        {data.analytics.timeSeries.length === 0 ? (
          <EmptyChart text="No data for this period" />
        ) : (
          <MultiLineChart series={sendsSeries} formatY={(v) => `${v}`} />
        )}
      </ChartCard>

      {/* ── By kind ── */}
      <ChartCard
        title="By Kind"
        subtitle="Attempted per kind — delivered shown below each"
      >
        {kindBars.length === 0 ? (
          <EmptyChart text="No data for this period" />
        ) : (
          <View style={styles.kindList}>
            {data.analytics.byKind.slice(0, 12).map((k, i) => (
              <KindRow
                key={k.kind}
                label={k.kind}
                attempted={k.attempted}
                succeeded={k.succeeded}
                deliveryRate={k.deliveryRate}
                max={kindBars[0]?.value ?? 1}
                color={kindColor(k.kind, i)}
              />
            ))}
          </View>
        )}
      </ChartCard>

      {/* ── Dispatches by source ── */}
      <ChartCard title="Dispatches by Source">
        {sourceDonut.length === 0 ? (
          <EmptyChart text="No data" />
        ) : (
          <DonutChart
            data={sourceDonut}
            centerLabel="Dispatches"
            centerValue={n(sourceDonut.reduce((s, d) => s + d.value, 0))}
          />
        )}
      </ChartCard>

      {/* ── New device registrations ── */}
      <ChartCard title="New Device Registrations">
        {regPoints.length === 0 ? (
          <EmptyChart text="No registrations for this period" />
        ) : (
          <LineChart
            data={regPoints}
            color={colors.emerald400}
            formatY={(v) => `${Math.round(v)}`}
          />
        )}
      </ChartCard>

      {/* ── Devices by platform ── */}
      <ChartCard title="Devices by Platform">
        {platformDonut.length === 0 ? (
          <EmptyChart text="No data" />
        ) : (
          <DonutChart
            data={platformDonut}
            centerLabel="Devices"
            centerValue={n(platformDonut.reduce((s, d) => s + d.value, 0))}
          />
        )}
      </ChartCard>

      {/* ── Devices by app version ── */}
      <ChartCard title="Devices by App Version">
        {versionBars.length === 0 ? (
          <EmptyChart text="No data" />
        ) : (
          <BarChart data={versionBars} horizontal formatValue={(v) => `${v}`} />
        )}
      </ChartCard>

      {/* ── Recent dispatches ── */}
      <ChartCard title="Recent Dispatches">
        {data.analytics.recent.length === 0 ? (
          <EmptyChart text="No dispatches in this period" />
        ) : (
          <View style={styles.recentList}>
            {data.analytics.recent.slice(0, 25).map((r, i) => (
              <RecentRow key={r.id} dispatch={r} colorIndex={i} />
            ))}
          </View>
        )}
      </ChartCard>

      <Text variant="tiny" color={colors.zinc600} style={styles.rangeNote}>
        {data.analytics.range.from} → {data.analytics.range.to}
      </Text>
    </>
  );
}

// ─────────── Small pieces ───────────

function n(v: number): string {
  return v.toLocaleString("en-IN");
}

function Tile({
  icon,
  label,
  value,
  valueColor,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor?: string;
  sub?: string;
}) {
  return (
    <View style={styles.tile}>
      <View style={styles.tileHead}>
        {icon}
        <Text variant="tiny" color={colors.zinc500}>
          {label}
        </Text>
      </View>
      <Text variant="bodyStrong" color={valueColor}>
        {value}
      </Text>
      {sub ? (
        <Text variant="tiny" color={colors.zinc600} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.filterRow}>
      <Text variant="tiny" color={colors.zinc500}>
        {label}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterChips}
      >
        {children}
      </ScrollView>
    </View>
  );
}

function Chip({
  active,
  onPress,
  children,
}: {
  active: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.filterChip, active && styles.filterChipActive]}
    >
      <Text
        variant="tiny"
        color={active ? colors.emerald400 : colors.zinc400}
        weight="600"
      >
        {children}
      </Text>
    </Pressable>
  );
}

function KindRow({
  label,
  attempted,
  succeeded,
  deliveryRate,
  max,
  color,
}: {
  label: string;
  attempted: number;
  succeeded: number;
  deliveryRate: number | null;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? (attempted / max) * 100 : 0;
  return (
    <View style={styles.kindRow}>
      <View style={styles.kindHead}>
        <Text
          variant="tiny"
          color={colors.zinc300}
          numberOfLines={1}
          style={styles.kindLabel}
        >
          {label}
        </Text>
        <Text variant="tiny" color={colors.foreground} weight="600">
          {n(attempted)}
        </Text>
      </View>
      <View style={styles.kindTrack}>
        <View
          style={[
            styles.kindFill,
            { width: `${pct}%`, backgroundColor: color, opacity: 0.9 },
          ]}
        />
      </View>
      <Text variant="tiny" color={colors.zinc600}>
        {n(succeeded)} delivered
        {deliveryRate == null ? "" : ` · ${deliveryRate}%`}
      </Text>
    </View>
  );
}

function RecentRow({
  dispatch: r,
  colorIndex,
}: {
  dispatch: PushAnalyticsResponse["analytics"]["recent"][number];
  colorIndex: number;
}) {
  const c = kindColor(r.kind, colorIndex);
  return (
    <View style={styles.recentRow}>
      <View style={styles.recentTop}>
        <View
          style={[styles.kindBadge, { backgroundColor: `${c}22` }]}
        >
          <Text variant="tiny" color={c} weight="600">
            {r.kind}
          </Text>
        </View>
        <Text variant="tiny" color={colors.zinc600} style={styles.recentWhen}>
          {formatWhen(r.createdAt)}
        </Text>
      </View>
      <Text variant="small" color={colors.foreground} numberOfLines={1}>
        {r.title}
      </Text>
      {r.body ? (
        <Text variant="tiny" color={colors.zinc500} numberOfLines={1}>
          {r.body}
        </Text>
      ) : null}
      <View style={styles.recentMeta}>
        <Text variant="tiny" color={colors.zinc500}>
          {titleCase(r.source)}
          {r.audience ? ` · ${r.audience}` : ""} · {titleCase(r.scope)}
        </Text>
      </View>
      <View style={styles.recentStats}>
        <Text variant="tiny" color={colors.zinc400}>
          Sent {n(r.attempted)}
        </Text>
        <Text variant="tiny" color={colors.emerald400}>
          Delivered {n(r.succeeded)}
        </Text>
        <Text
          variant="tiny"
          color={r.failed > 0 ? colors.destructive : colors.zinc600}
        >
          Failed {n(r.failed)}
        </Text>
      </View>
    </View>
  );
}

function EmptyChart({ text }: { text: string }) {
  return (
    <View style={styles.emptyChart}>
      <Text variant="small" color={colors.zinc500}>
        {text}
      </Text>
    </View>
  );
}

// ─────────── Formatting / color helpers ───────────

/** "2026-03-14" → "14/3" — terse axis labels (mirror of web's shortDate). */
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}`;
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "16 Jun, 02:30 PM" — recent-dispatch timestamp. */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Source palette — mirror of web's SOURCE_COLORS.
const SOURCE_PALETTE: Record<string, string> = {
  event: "#60a5fa",
  broadcast: "#a78bfa",
  test: "#f59e0b",
};

function sourceColor(source: string, index: number): string {
  return SOURCE_PALETTE[source] ?? CHART_COLORS[index % CHART_COLORS.length];
}

// Stable-ish color for a kind (hash → palette index) so the same kind
// keeps its color across renders. Mirror of web's kindColor.
function kindColor(kind: string, fallbackIndex: number): string {
  if (!kind) return CHART_COLORS[fallbackIndex % CHART_COLORS.length];
  let h = 0;
  for (let i = 0; i < kind.length; i++) h = (h * 31 + kind.charCodeAt(i)) >>> 0;
  return CHART_COLORS[h % CHART_COLORS.length];
}

// ─────────── Range / source / scope controls ───────────

type RangeKey = "30D" | "90D" | "ALL";
type ScopeKey = "all" | "customer" | "admin";

const RANGES: { value: RangeKey; label: string }[] = [
  { value: "30D", label: "30 days" },
  { value: "90D", label: "90 days" },
  { value: "ALL", label: "All time" },
];

const SOURCES = ["event", "broadcast", "test"] as const;
const SCOPES: ScopeKey[] = ["all", "customer", "admin"];

function resolveRange(key: RangeKey): { from: string | null; to: string | null } {
  if (key === "ALL") return { from: null, to: null };
  const days = key === "30D" ? 30 : 90;
  const today = new Date();
  const from = new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: ymd(from), to: ymd(today) };
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  chipRow: { flexDirection: "row", gap: spacing["2"], paddingVertical: spacing["1"] },
  chip: {
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["1.5"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  chipActive: {
    borderColor: "rgba(250, 204, 21, 0.40)",
    backgroundColor: "rgba(250, 204, 21, 0.10)",
  },
  filterRow: { gap: spacing["1.5"] },
  filterChips: { flexDirection: "row", gap: spacing["1.5"], paddingVertical: 2 },
  filterChip: {
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["1.5"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  filterChipActive: {
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_20,
  },
  clearChip: {
    paddingHorizontal: spacing["2"],
    paddingVertical: spacing["1.5"],
  },
  tileRow: { flexDirection: "row", gap: spacing["2"] },
  tile: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["3"],
    gap: 6,
  },
  tileHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  emptyChart: {
    paddingVertical: spacing["10"],
    alignItems: "center",
    justifyContent: "center",
  },
  kindList: { gap: spacing["2.5"] },
  kindRow: { gap: 4 },
  kindHead: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  kindLabel: { flex: 1 },
  kindTrack: {
    height: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.muted,
    overflow: "hidden",
  },
  kindFill: { height: 8, borderRadius: radius.sm },
  recentList: { gap: spacing["3"] },
  recentRow: {
    gap: 4,
    paddingBottom: spacing["3"],
    borderBottomWidth: 1,
    borderBottomColor: colors.zinc800_50,
  },
  recentTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing["2"],
  },
  kindBadge: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
  },
  recentWhen: { flexShrink: 0 },
  recentMeta: { flexDirection: "row" },
  recentStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["3"],
    marginTop: 2,
  },
  rangeNote: { textAlign: "center", marginTop: spacing["1"] },
  errorBlock: {
    padding: spacing["4"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.30)",
    backgroundColor: "rgba(239, 68, 68, 0.10)",
    gap: spacing["1"],
  },
});
