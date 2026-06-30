import { useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Filter } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminInsightsApi,
  FUNNEL_OPTIONS,
  type FunnelKey,
  type FunnelScreenResult,
} from "../../lib/admin-insights";

/**
 * Funnels — full parity with web /admin/analytics/funnels.
 *
 * Renders the same surface the web dashboard does:
 *   - funnel picker (every FUNNELS key) + date-range controls
 *   - six overview KPI tiles (sessions, signed-in users, bookings
 *     confirmed, waitlist joined, unmet-demand taps, waitlist conv.)
 *   - a per-step bar chart where each bar is colour-graded by its
 *     drop-off severity (emerald → yellow → orange → red), same
 *     `colorFor` thresholds as the web Recharts cells
 *   - a per-step table with every column the web shows: sessions,
 *     users, % of step 1, drop-off
 *
 * No external chart lib needed: bars are width-scaled Views, same
 * idiom as the expense analytics screen. Sessions, not users — anon
 * visitors count until they sign in (matches the web copy).
 */
export function AdminFunnelsScreen() {
  const [funnelKey, setFunnelKey] = useState<FunnelKey>("booking");
  const [range, setRange] = useState<RangeKey>("LAST_30");

  const { from, to } = useMemo(() => resolveRange(range), [range]);

  const query = useQuery({
    queryKey: ["admin-funnel", funnelKey, from, to],
    queryFn: () => adminInsightsApi.funnel({ key: funnelKey, from, to }),
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
        {/* Funnel picker */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {FUNNEL_OPTIONS.map((f) => (
            <Pressable
              key={f.key}
              onPress={() => setFunnelKey(f.key)}
              style={[styles.chip, funnelKey === f.key && styles.chipActive]}
            >
              <Text
                variant="tiny"
                color={funnelKey === f.key ? colors.yellow400 : colors.zinc300}
                weight="600"
              >
                {f.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Date range */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {RANGES.map((r) => (
            <Pressable
              key={r.value}
              onPress={() => setRange(r.value)}
              style={[
                styles.chipSmall,
                range === r.value && styles.chipActive,
              ]}
            >
              <Text
                variant="tiny"
                color={range === r.value ? colors.yellow400 : colors.zinc500}
                weight="600"
              >
                {r.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {query.isLoading ? (
          <View style={{ gap: spacing["3"] }}>
            <Skeleton width="100%" height={88} rounded="md" />
            <Skeleton width="100%" height={240} rounded="md" />
          </View>
        ) : query.isError ? (
          <Pressable
            onPress={() => void query.refetch()}
            style={styles.errorBlock}
          >
            <Text variant="body" color={colors.destructive}>
              Couldn't load funnel. Tap to retry.
            </Text>
            <Text variant="tiny" color={colors.zinc500}>
              {query.error instanceof Error
                ? query.error.message
                : "Unknown error"}
            </Text>
          </Pressable>
        ) : query.data ? (
          <Body data={query.data} range={{ from, to }} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/**
 * Drop-off severity → bar colour. Mirrors the web `colorFor`: the entry
 * step is emerald, then graduates to red as the step-over-step drop
 * grows, so the worst-bleeding step jumps out at a glance.
 */
function colorFor(dropOffPct: number): string {
  if (dropOffPct === 0) return colors.emerald500; // entry / no drop
  if (dropOffPct < 25) return colors.emerald400; // small drop
  if (dropOffPct < 50) return colors.yellow400; // moderate
  if (dropOffPct < 75) return "#fb923c"; // heavy (orange-400)
  return colors.destructive; // bleeding (red)
}

/** Drop-off severity → text colour for the table cell, matching web. */
function dropOffColor(dropOffPct: number): string {
  if (dropOffPct === 0) return colors.zinc500;
  if (dropOffPct < 25) return colors.emerald400;
  if (dropOffPct < 50) return colors.yellow400;
  if (dropOffPct < 75) return "#fb923c";
  return colors.destructive_300;
}

function Body({
  data,
  range,
}: {
  data: FunnelScreenResult;
  range: { from: string; to: string };
}) {
  const { funnel, overview } = data;
  const rows = funnel.rows;
  const top = rows[0]?.count ?? 0;
  const empty = rows.every((r) => r.count === 0);

  return (
    <>
      {/* Overview KPI tiles — same six the web shows */}
      <View style={styles.tileGrid}>
        <Tile label="Sessions" value={overview.sessions.toLocaleString("en-IN")} />
        <Tile
          label="Signed-in users"
          value={overview.signedInUsers.toLocaleString("en-IN")}
        />
        <Tile
          label="Bookings confirmed"
          value={overview.bookingsConfirmed.toLocaleString("en-IN")}
        />
        <Tile
          label="Waitlist joined"
          value={overview.waitlistJoined.toLocaleString("en-IN")}
        />
        <Tile
          label="Unmet-demand taps"
          value={overview.unmetDemandTaps.toLocaleString("en-IN")}
        />
        <Tile
          label="Waitlist conv."
          value={`${overview.waitlistConversionPct}%`}
        />
      </View>

      {/* Funnel bar chart */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Filter size={12} color={colors.zinc500} />
          <Text
            variant="tiny"
            color={colors.zinc300}
            style={styles.sectionTitle}
          >
            {funnel.label.toUpperCase()} FUNNEL
          </Text>
        </View>
        <Text variant="tiny" color={colors.zinc500}>
          {range.from} → {range.to}
        </Text>

        {empty ? (
          <Text variant="tiny" color={colors.zinc600} style={{ marginTop: spacing["3"] }}>
            No events in this window yet. Either nobody hit step 1 or the
            funnel hasn't been instrumented.
          </Text>
        ) : (
          <View style={{ gap: spacing["3"], marginTop: spacing["1"] }}>
            {rows.map((r, idx) => {
              const widthPct = top > 0 ? (r.count / top) * 100 : 0;
              const fill = colorFor(r.dropOffPct);
              return (
                <View key={r.step} style={styles.stepRow}>
                  <View style={styles.stepHead}>
                    <Text
                      variant="tiny"
                      color={colors.zinc300}
                      numberOfLines={1}
                      style={{ flex: 1 }}
                    >
                      {idx + 1}. {prettyStep(r.step)}
                    </Text>
                    <Text variant="tiny" color={colors.foreground} weight="600">
                      {r.count.toLocaleString("en-IN")}
                    </Text>
                  </View>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          width: `${Math.max(widthPct, r.count > 0 ? 2 : 0)}%`,
                          backgroundColor: fill,
                        },
                      ]}
                    />
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* Per-step table — every column the web table has */}
      <View style={styles.tableCard}>
        <View style={[styles.tableRow, styles.tableHead]}>
          <Text variant="tiny" color={colors.zinc500} style={styles.colStep}>
            STEP
          </Text>
          <Text variant="tiny" color={colors.zinc500} style={styles.colNum}>
            SESS.
          </Text>
          <Text variant="tiny" color={colors.zinc500} style={styles.colNum}>
            USERS
          </Text>
          <Text variant="tiny" color={colors.zinc500} style={styles.colNum}>
            % S1
          </Text>
          <Text variant="tiny" color={colors.zinc500} style={styles.colNum}>
            DROP
          </Text>
        </View>
        {rows.map((r, idx) => (
          <View
            key={r.step}
            style={[
              styles.tableRow,
              idx < rows.length - 1 && styles.tableRowBorder,
            ]}
          >
            <View style={styles.colStep}>
              <Text variant="tiny" color={colors.zinc300} numberOfLines={1}>
                <Text variant="tiny" color={colors.zinc500}>
                  {idx + 1}.{" "}
                </Text>
                {prettyStep(r.step)}
              </Text>
            </View>
            <Text variant="tiny" color={colors.foreground} style={styles.colNum}>
              {r.count.toLocaleString("en-IN")}
            </Text>
            <Text variant="tiny" color={colors.zinc400} style={styles.colNum}>
              {r.uniqueUsers.toLocaleString("en-IN")}
            </Text>
            <Text variant="tiny" color={colors.zinc300} style={styles.colNum}>
              {r.ratePct}%
            </Text>
            <Text
              variant="tiny"
              color={dropOffColor(r.dropOffPct)}
              weight="600"
              style={styles.colNum}
            >
              {r.dropOffPct === 0 ? "—" : `-${r.dropOffPct}%`}
            </Text>
          </View>
        ))}
      </View>
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tile}>
      <Text variant="tiny" color={colors.zinc500} numberOfLines={1}>
        {label}
      </Text>
      <Text variant="bodyStrong" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function prettyStep(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

type RangeKey = "LAST_7" | "LAST_30" | "LAST_90";

const RANGES: { value: RangeKey; label: string }[] = [
  { value: "LAST_7", label: "7d" },
  { value: "LAST_30", label: "30d" },
  { value: "LAST_90", label: "90d" },
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
  chipSmall: {
    paddingHorizontal: spacing["2.5"],
    paddingVertical: spacing["1"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  chipActive: {
    borderColor: "rgba(250, 204, 21, 0.40)",
    backgroundColor: "rgba(250, 204, 21, 0.10)",
  },
  // 2-column tile grid → 6 tiles, matching the web KPI strip content.
  tileGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["2"],
  },
  tile: {
    // two per row, accounting for the gap
    flexBasis: "48%",
    flexGrow: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["3"],
    gap: 4,
  },
  section: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["4"],
    gap: spacing["1.5"],
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
  },
  sectionTitle: { letterSpacing: 1.5, fontWeight: "700" },
  stepRow: { gap: 6 },
  stepHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  barTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.zinc800,
    overflow: "hidden",
  },
  barFill: {
    height: 10,
    borderRadius: 5,
  },
  // Table
  tableCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    overflow: "hidden",
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2.5"],
    gap: spacing["1"],
  },
  tableHead: {
    borderBottomWidth: 1,
    borderBottomColor: colors.zinc800,
  },
  tableRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(39, 39, 42, 0.50)",
  },
  colStep: { flex: 1, minWidth: 0 },
  colNum: {
    width: 44,
    textAlign: "right",
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
