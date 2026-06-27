import { useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Activity, Filter, TrendingDown, Users } from "lucide-react-native";
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
 * Funnels — mirrors web /admin/analytics/funnels. Pick a predefined
 * funnel; each step is a stacked row with a width-scaled bar, the
 * session count, the conversion % off step 0, and the drop-off from
 * the previous step. Overview KPIs sit on top.
 *
 * No chart lib: bars are plain Views, same idiom as the expense
 * analytics screen.
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
            <Skeleton width="100%" height={64} rounded="md" />
            <Skeleton width="100%" height={220} rounded="md" />
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
          <Body data={query.data} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Body({ data }: { data: FunnelScreenResult }) {
  const { funnel, overview } = data;
  const rows = funnel.rows;
  const top = rows[0]?.count ?? 0;
  const last = rows[rows.length - 1];
  const overall = last ? last.ratePct : 0;

  return (
    <>
      <View style={styles.tileRow}>
        <Tile
          icon={<Users size={14} color={colors.emerald400} />}
          label="Sessions"
          value={overview.sessions.toLocaleString("en-IN")}
        />
        <Tile
          icon={<Activity size={14} color={colors.yellow400} />}
          label="Signed in"
          value={overview.signedInUsers.toLocaleString("en-IN")}
        />
        <Tile
          icon={<TrendingDown size={14} color={"#fb923c"} />}
          label="Overall conv."
          value={`${overall}%`}
        />
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Filter size={12} color={colors.zinc500} />
          <Text
            variant="tiny"
            color={colors.zinc500}
            style={styles.sectionTitle}
          >
            {funnel.label.toUpperCase()} FUNNEL
          </Text>
        </View>
        {rows.length === 0 ? (
          <Text variant="tiny" color={colors.zinc600}>
            No events for this funnel in range.
          </Text>
        ) : (
          <View style={{ gap: spacing["3"] }}>
            {rows.map((r, idx) => {
              const widthPct = top > 0 ? (r.count / top) * 100 : 0;
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
                        },
                      ]}
                    />
                  </View>
                  <View style={styles.stepFoot}>
                    <Text variant="tiny" color={colors.emerald400}>
                      {r.ratePct}% of start
                    </Text>
                    {idx > 0 && r.dropOffPct > 0 ? (
                      <Text variant="tiny" color={colors.destructive_300}>
                        −{r.dropOffPct}% drop-off
                      </Text>
                    ) : (
                      <Text variant="tiny" color={colors.zinc600}>
                        {r.uniqueUsers.toLocaleString("en-IN")} users
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}
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
  stepFoot: {
    flexDirection: "row",
    justifyContent: "space-between",
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
    backgroundColor: colors.emerald500,
    opacity: 0.55,
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
