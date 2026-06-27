import { useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Flame, TrendingUp, Users } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminInsightsApi,
  type DemandResult,
} from "../../lib/admin-insights";

/**
 * Demand heatmap — mirrors web /admin/analytics/demand. A 7×N grid
 * (rows = day of week Mon→Sun, cols = hour of day) of unmet booking
 * demand intensity, colour-graded from cold (low) to hot (high).
 *
 * No chart lib: each cell is a plain View whose background is an
 * emerald→yellow→red gradient picked off the per-cell intensity vs the
 * grid max. A range chip row and a sport filter sit above the grid.
 */
export function AdminDemandScreen() {
  const [range, setRange] = useState<RangeKey>("LAST_30");
  const [sport, setSport] = useState<string>("ALL");

  const { from, to } = useMemo(() => resolveRange(range), [range]);

  const query = useQuery({
    queryKey: ["admin-demand", from, to],
    queryFn: () => adminInsightsApi.demand({ from, to }),
    refetchOnWindowFocus: false,
  });

  const refreshing =
    (query.isFetching && !query.isLoading) || query.isRefetching;

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
          <View style={{ gap: spacing["3"] }}>
            <Skeleton width="100%" height={64} rounded="md" />
            <Skeleton width="100%" height={220} rounded="md" />
          </View>
        ) : query.isError ? (
          <Pressable
            onPress={() => void query.refetch()}
            style={styles.errorBlock}
          >
            <Text variant="body" color={colors.destructive}>
              Couldn't load demand. Tap to retry.
            </Text>
            <Text variant="tiny" color={colors.zinc500}>
              {query.error instanceof Error
                ? query.error.message
                : "Unknown error"}
            </Text>
          </Pressable>
        ) : query.data ? (
          <Body data={query.data} sport={sport} setSport={setSport} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Body({
  data,
  sport,
  setSport,
}: {
  data: DemandResult;
  sport: string;
  setSport: (s: string) => void;
}) {
  // Sports present in the data (for the filter chips).
  const sports = useMemo(() => {
    const set = new Set<string>();
    for (const c of data.cells) if (c.sport && c.sport !== "_") set.add(c.sport);
    return [...set].sort();
  }, [data.cells]);

  // Cells matching the active sport filter.
  const filtered = useMemo(
    () =>
      sport === "ALL"
        ? data.cells
        : data.cells.filter((c) => c.sport === sport),
    [data.cells, sport],
  );

  // Hours that actually appear, so the grid stays compact.
  const hours = useMemo(() => {
    const set = new Set<number>();
    for (const c of filtered) set.add(c.hour);
    return [...set].sort((a, b) => a - b);
  }, [filtered]);

  // (dow,hour) -> summed intensity across sports in scope.
  const grid = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of filtered) {
      const key = `${c.dayOfWeek}-${c.hour}`;
      m.set(key, (m.get(key) ?? 0) + c.intensity);
    }
    return m;
  }, [filtered]);

  const max = useMemo(() => {
    let mx = 0;
    for (const v of grid.values()) if (v > mx) mx = v;
    return mx;
  }, [grid]);

  const total = useMemo(
    () => filtered.reduce((s, c) => s + c.intensity, 0),
    [filtered],
  );

  // Peak (dow,hour) cell for the KPI.
  const peak = useMemo(() => {
    let best: { key: string; val: number } | null = null;
    for (const [key, val] of grid) {
      if (!best || val > best.val) best = { key, val };
    }
    if (!best) return null;
    const [dow, hour] = best.key.split("-").map(Number);
    return { dow, hour, val: best.val };
  }, [grid]);

  return (
    <>
      <View style={styles.tileRow}>
        <Tile
          icon={<Flame size={14} color={"#fb923c"} />}
          label="Total signals"
          value={total.toLocaleString("en-IN")}
        />
        <Tile
          icon={<TrendingUp size={14} color={colors.yellow400} />}
          label="Peak slot"
          value={
            peak
              ? `${DAYS[peak.dow]} ${fmtHour(peak.hour)}`
              : "—"
          }
        />
        <Tile
          icon={<Users size={14} color={colors.emerald400} />}
          label="Hottest"
          value={peak ? String(peak.val) : "—"}
        />
      </View>

      {/* Sport filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {["ALL", ...sports].map((s) => (
          <Pressable
            key={s}
            onPress={() => setSport(s)}
            style={[styles.chip, sport === s && styles.chipActive]}
          >
            <Text
              variant="tiny"
              color={sport === s ? colors.yellow400 : colors.zinc300}
              weight="600"
            >
              {s === "ALL" ? "All sports" : prettySport(s)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Heatmap grid */}
      <View style={styles.section}>
        <Text variant="tiny" color={colors.zinc500} style={styles.sectionTitle}>
          DAY × HOUR — UNMET DEMAND
        </Text>
        {hours.length === 0 ? (
          <Text variant="tiny" color={colors.zinc600}>
            No demand signals in this range.
          </Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              {/* Header row: hour labels */}
              <View style={styles.gridRow}>
                <View style={styles.dayLabel} />
                {hours.map((h) => (
                  <View key={h} style={styles.cell}>
                    <Text variant="tiny" color={colors.zinc600}>
                      {h}
                    </Text>
                  </View>
                ))}
              </View>
              {DAYS.map((day, dow) => (
                <View key={day} style={styles.gridRow}>
                  <View style={styles.dayLabel}>
                    <Text variant="tiny" color={colors.zinc400} weight="600">
                      {day}
                    </Text>
                  </View>
                  {hours.map((h) => {
                    const v = grid.get(`${dow}-${h}`) ?? 0;
                    return (
                      <View
                        key={h}
                        style={[
                          styles.cell,
                          styles.heatCell,
                          { backgroundColor: heatColor(v, max) },
                        ]}
                      >
                        {v > 0 ? (
                          <Text
                            variant="tiny"
                            color={v / (max || 1) > 0.5 ? "#000" : colors.zinc300}
                            weight="600"
                          >
                            {v}
                          </Text>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
        )}
        {/* Legend */}
        <View style={styles.legendRow}>
          <Text variant="tiny" color={colors.zinc600}>
            Low
          </Text>
          {[0.15, 0.35, 0.55, 0.75, 0.95].map((t) => (
            <View
              key={t}
              style={[
                styles.legendSwatch,
                { backgroundColor: heatColor(t, 1) },
              ]}
            />
          ))}
          <Text variant="tiny" color={colors.zinc600}>
            High
          </Text>
        </View>
      </View>
    </>
  );
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
      <View style={styles.tileHead}>{icon}</View>
      <Text variant="bodyStrong" numberOfLines={1}>
        {value}
      </Text>
      <Text variant="tiny" color={colors.zinc500} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// Emerald (cold) → yellow → red (hot) graded by intensity ratio.
function heatColor(value: number, max: number): string {
  if (value <= 0) return colors.zinc900;
  const t = max > 0 ? Math.min(value / max, 1) : 0;
  // Three-stop interpolation: emerald -> yellow -> red.
  const stops: [number, [number, number, number]][] = [
    [0, [16, 185, 129]],
    [0.5, [250, 204, 21]],
    [1, [239, 68, 68]],
  ];
  let lo = stops[0];
  let hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) {
      lo = stops[i];
      hi = stops[i + 1];
      break;
    }
  }
  const span = hi[0] - lo[0] || 1;
  const k = (t - lo[0]) / span;
  const r = Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * k);
  const g = Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * k);
  const b = Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * k);
  const alpha = 0.25 + 0.6 * t;
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtHour(h: number): string {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

function prettySport(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

type RangeKey = "LAST_7" | "LAST_30" | "LAST_90";

const RANGES: { value: RangeKey; label: string }[] = [
  { value: "LAST_7", label: "Last 7 days" },
  { value: "LAST_30", label: "Last 30 days" },
  { value: "LAST_90", label: "Last 90 days" },
];

function resolveRange(key: RangeKey): { from: string; to: string } {
  const today = new Date();
  const days = key === "LAST_7" ? 7 : key === "LAST_30" ? 30 : 90;
  const from = new Date(today);
  from.setDate(from.getDate() - (days - 1));
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
  chipRow: {
    flexDirection: "row",
    gap: spacing["2"],
    paddingVertical: spacing["1"],
  },
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
  tileRow: {
    flexDirection: "row",
    gap: spacing["2"],
  },
  tile: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["3"],
    gap: 6,
  },
  tileHead: {
    flexDirection: "row",
    alignItems: "center",
  },
  section: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["4"],
    gap: spacing["3"],
  },
  sectionTitle: { letterSpacing: 1.5, fontWeight: "700" },
  gridRow: {
    flexDirection: "row",
  },
  dayLabel: {
    width: 34,
    height: 26,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  cell: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    margin: 1,
  },
  heatCell: {
    borderRadius: 4,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  legendSwatch: {
    width: 18,
    height: 12,
    borderRadius: 3,
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
