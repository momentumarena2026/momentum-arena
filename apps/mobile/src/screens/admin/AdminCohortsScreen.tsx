import { useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Users, UserCheck } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminInsightsApi,
  type CohortGridResult,
} from "../../lib/admin-insights";

/**
 * Cohorts — mirrors web /admin/analytics/cohorts. Week-on-week
 * retention grid: rows = cohort week (when users first showed up),
 * columns = weeks-since-cohort, each cell = % of the cohort that fired
 * any event during that follow-up week.
 *
 * No chart lib: a compact grid of colour-graded cells. The deeper the
 * emerald, the higher the retention.
 */
export function AdminCohortsScreen() {
  const [weeks, setWeeks] = useState<number>(8);

  const query = useQuery({
    queryKey: ["admin-cohorts", weeks],
    queryFn: () => adminInsightsApi.cohorts({ weeks }),
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
          {WEEK_OPTIONS.map((w) => (
            <Pressable
              key={w}
              onPress={() => setWeeks(w)}
              style={[styles.chip, weeks === w && styles.chipActive]}
            >
              <Text
                variant="tiny"
                color={weeks === w ? colors.yellow400 : colors.zinc300}
                weight="600"
              >
                {w} weeks
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
              Couldn't load cohorts. Tap to retry.
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

function Body({ data }: { data: CohortGridResult }) {
  // Rows shown newest cohort first.
  const cohorts = useMemo(
    () =>
      [...data.cohorts].sort((a, b) =>
        b.cohortStart.localeCompare(a.cohortStart),
      ),
    [data.cohorts],
  );

  const totalUsers = useMemo(
    () => cohorts.reduce((s, c) => s + c.cohortSize, 0),
    [cohorts],
  );

  // Average week-1 retention across cohorts that have a week-1 cell.
  const avgWeek1 = useMemo(() => {
    const rates: number[] = [];
    for (const c of cohorts) {
      const cell = c.cells.find((x) => x.weekIndex === 1);
      if (cell) rates.push(cell.ratePct);
    }
    if (rates.length === 0) return null;
    return Math.round((rates.reduce((s, r) => s + r, 0) / rates.length) * 10) / 10;
  }, [cohorts]);

  if (cohorts.length === 0) {
    return (
      <View style={styles.section}>
        <Text variant="tiny" color={colors.zinc600}>
          No cohorts yet. Retention shows up once users start returning
          week-on-week.
        </Text>
      </View>
    );
  }

  return (
    <>
      <View style={styles.tileRow}>
        <Tile
          icon={<Users size={14} color={colors.emerald400} />}
          label="Total users"
          value={totalUsers.toLocaleString("en-IN")}
        />
        <Tile
          icon={<UserCheck size={14} color={colors.yellow400} />}
          label="Avg W1 retention"
          value={avgWeek1 != null ? `${avgWeek1}%` : "—"}
        />
        <Tile
          icon={<Users size={14} color={colors.zinc300} />}
          label="Cohorts"
          value={String(cohorts.length)}
        />
      </View>

      <View style={styles.section}>
        <Text variant="tiny" color={colors.zinc500} style={styles.sectionTitle}>
          WEEK-ON-WEEK RETENTION
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            {/* Header */}
            <View style={styles.gridRow}>
              <View style={styles.rowLabel}>
                <Text variant="tiny" color={colors.zinc600}>
                  Cohort
                </Text>
              </View>
              <View style={styles.sizeCol}>
                <Text variant="tiny" color={colors.zinc600}>
                  Size
                </Text>
              </View>
              {Array.from({ length: data.weeks }, (_, i) => (
                <View key={i} style={styles.cell}>
                  <Text variant="tiny" color={colors.zinc600}>
                    W{i}
                  </Text>
                </View>
              ))}
            </View>
            {cohorts.map((c) => (
              <View key={c.cohortStart} style={styles.gridRow}>
                <View style={styles.rowLabel}>
                  <Text variant="tiny" color={colors.zinc400} weight="600">
                    {prettyWeek(c.cohortStart)}
                  </Text>
                </View>
                <View style={styles.sizeCol}>
                  <Text variant="tiny" color={colors.zinc300}>
                    {c.cohortSize}
                  </Text>
                </View>
                {Array.from({ length: data.weeks }, (_, i) => {
                  const cell = c.cells.find((x) => x.weekIndex === i);
                  if (!cell) {
                    return <View key={i} style={[styles.cell, styles.emptyCell]} />;
                  }
                  const pct = cell.ratePct;
                  return (
                    <View
                      key={i}
                      style={[
                        styles.cell,
                        styles.dataCell,
                        { backgroundColor: retentionColor(pct) },
                      ]}
                    >
                      <Text
                        variant="tiny"
                        color={pct > 55 ? "#000" : colors.zinc300}
                        weight="600"
                      >
                        {Math.round(pct)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
        <Text variant="tiny" color={colors.zinc600}>
          Cell = % of the cohort active that week. W0 is always 100%.
        </Text>
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

// Emerald, more opaque as retention rises.
function retentionColor(pct: number): string {
  if (pct <= 0) return colors.zinc900;
  const t = Math.min(pct / 100, 1);
  const alpha = 0.12 + 0.78 * t;
  return `rgba(16, 185, 129, ${alpha.toFixed(2)})`;
}

function prettyWeek(iso: string): string {
  // "2026-04-13T..." → "13 Apr"
  const d = new Date(iso);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

const WEEK_OPTIONS = [4, 8, 12, 16];

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
    alignItems: "center",
  },
  rowLabel: {
    width: 52,
    height: 28,
    justifyContent: "center",
  },
  sizeCol: {
    width: 34,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  cell: {
    width: 30,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    margin: 1,
  },
  dataCell: {
    borderRadius: 4,
  },
  emptyCell: {
    backgroundColor: "transparent",
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
