import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Bell,
  CheckCircle2,
  Send,
  Smartphone,
  XCircle,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminAnalyticsApi,
  type PushAnalyticsResponse,
} from "../../lib/admin-analytics";

/**
 * Read-only push analytics — mobile mirror of web
 * /admin/analytics/push. Range chips (30d / 90d / All) drive a
 * getPushAnalytics fetch; "All" sends no from/to so the route defaults
 * to earliest-dispatch → today (lifetime totals).
 *
 * KPIs are counts (no money): sent/attempted/delivered/failed +
 * delivery rate. Breakdowns: by-kind delivery bars + device fleet
 * (iOS / Android / admin, active vs stale, reach).
 */
export function AdminPushAnalyticsScreen() {
  const [range, setRange] = useState<RangeKey>("ALL");
  const { from, to } = useMemo(() => resolveRange(range), [range]);

  const query = useQuery({
    queryKey: ["admin-push-analytics", from ?? "ALL", to ?? "ALL"],
    queryFn: () =>
      adminAnalyticsApi.push({ from: from ?? undefined, to: to ?? undefined }),
    refetchOnWindowFocus: false,
  });

  const refreshing = (query.isFetching && !query.isLoading) || query.isRefetching;

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

        {query.isLoading ? (
          <View style={styles.tileRow}>
            <Skeleton width="48%" height={64} rounded="md" />
            <Skeleton width="48%" height={64} rounded="md" />
          </View>
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

function Body({ data }: { data: PushAnalyticsResponse }) {
  const t = data.analytics.totals;
  const fleet = data.analytics.fleet;
  const byKind = data.analytics.byKind.slice(0, 12);
  const kindMax = Math.max(...byKind.map((k) => k.attempted), 1);

  return (
    <>
      <View style={styles.tileRow}>
        <Tile
          icon={<Send size={14} color={colors.yellow400} />}
          label="Dispatches"
          value={n(t.dispatches)}
        />
        <Tile
          icon={<Bell size={14} color={colors.zinc300} />}
          label="Attempted"
          value={n(t.attempted)}
        />
      </View>
      <View style={styles.tileRow}>
        <Tile
          icon={<CheckCircle2 size={14} color={colors.emerald400} />}
          label="Delivered"
          value={n(t.succeeded)}
        />
        <Tile
          icon={<XCircle size={14} color={colors.destructive} />}
          label="Failed"
          value={n(t.failed)}
        />
      </View>
      <View style={styles.tileRow}>
        <Tile
          icon={<BarChart3 size={14} color={"#a78bfa"} />}
          label="Delivery rate"
          value={t.deliveryRate == null ? "—" : `${t.deliveryRate}%`}
        />
        <Tile
          icon={<Send size={14} color={"#fb923c"} />}
          label="Broadcasts"
          value={n(t.broadcasts)}
        />
      </View>

      {/* Device fleet */}
      <View style={styles.tileRow}>
        <Tile
          icon={<Smartphone size={14} color={colors.emerald400} />}
          label="Devices"
          value={n(fleet.totalDevices)}
        />
        <Tile
          icon={<Smartphone size={14} color={colors.yellow400} />}
          label="Active (30d)"
          value={n(fleet.activeDevices)}
        />
      </View>
      <View style={styles.tileRow}>
        <Tile
          icon={<Smartphone size={14} color={colors.zinc300} />}
          label="iOS / Android"
          value={`${n(fleet.iosDevices)} / ${n(fleet.androidDevices)}`}
        />
        <Tile
          icon={<Smartphone size={14} color={"#a78bfa"} />}
          label="Reach (users)"
          value={n(fleet.reachUsers)}
        />
      </View>

      {/* By-kind delivery bars */}
      {byKind.length > 0 ? (
        <Section title="BY KIND (ATTEMPTED · DELIVERED)">
          {byKind.map((k) => (
            <BarRow
              key={k.kind}
              label={k.kind}
              value={n(k.attempted)}
              subtext={`${n(k.succeeded)} delivered${
                k.deliveryRate == null ? "" : ` · ${k.deliveryRate}%`
              }`}
              amount={k.attempted}
              max={kindMax}
              color={colors.yellow400}
            />
          ))}
        </Section>
      ) : null}

      {/* App-version mix */}
      {fleet.byAppVersion.length > 0 ? (
        <Section title="APP VERSIONS">
          {(() => {
            const rows = fleet.byAppVersion.slice(0, 8);
            const max = Math.max(...rows.map((r) => r.count), 1);
            return rows.map((r) => (
              <BarRow
                key={r.version}
                label={r.version}
                value={n(r.count)}
                amount={r.count}
                max={max}
                color={colors.emerald400}
              />
            ));
          })()}
        </Section>
      ) : null}

      <Text variant="tiny" color={colors.zinc600} style={styles.rangeNote}>
        {data.analytics.range.from} → {data.analytics.range.to}
      </Text>
    </>
  );
}

function n(v: number): string {
  return v.toLocaleString("en-IN");
}

function Tile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.tile}>
      <View style={styles.tileHead}>
        {icon}
        <Text variant="tiny" color={colors.zinc500}>
          {label}
        </Text>
      </View>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <BarChart3 size={12} color={colors.zinc500} />
        <Text variant="tiny" color={colors.zinc500} style={styles.sectionTitle}>
          {title}
        </Text>
      </View>
      <View style={{ gap: spacing["1.5"] }}>{children}</View>
    </View>
  );
}

function BarRow({
  label,
  value,
  subtext,
  amount,
  max,
  color,
}: {
  label: string;
  value: string;
  subtext?: string;
  amount: number;
  max: number;
  color: string;
}) {
  const widthPct = max > 0 ? (amount / max) * 100 : 0;
  return (
    <View style={styles.barRow}>
      <View style={styles.barHead}>
        <Text variant="tiny" color={colors.zinc300} numberOfLines={1} style={{ flex: 1 }}>
          {label}
        </Text>
        <Text variant="tiny" color={colors.foreground} weight="600">
          {value}
        </Text>
      </View>
      <View style={styles.barTrack}>
        <View
          style={[styles.barFill, { width: `${widthPct}%`, backgroundColor: color, opacity: 0.45 }]}
        />
      </View>
      {subtext ? (
        <Text variant="tiny" color={colors.zinc600}>
          {subtext}
        </Text>
      ) : null}
    </View>
  );
}

type RangeKey = "30D" | "90D" | "ALL";

const RANGES: { value: RangeKey; label: string }[] = [
  { value: "30D", label: "30 days" },
  { value: "90D", label: "90 days" },
  { value: "ALL", label: "All time" },
];

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
  section: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["4"],
    gap: spacing["2"],
  },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: spacing["1.5"] },
  sectionTitle: { letterSpacing: 1.5, fontWeight: "700" },
  barRow: { gap: 4 },
  barHead: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.zinc800,
    overflow: "hidden",
  },
  barFill: { height: 6, borderRadius: 3 },
  rangeNote: { textAlign: "center" },
  errorBlock: {
    padding: spacing["4"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.30)",
    backgroundColor: "rgba(239, 68, 68, 0.10)",
    gap: spacing["1"],
  },
});
