import { useMemo, useState, type ReactNode } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Lock,
  RotateCcw,
  Settings2,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminCalendarApi,
  type AdminCalendarSport,
  type CalendarConfig,
  type CalendarData,
  type CellData,
} from "../../lib/admin-calendar";
import {
  formatHourCompact,
  sportLabel,
} from "../../lib/format";
import { getTodayIST } from "../../lib/ist-date";
import type {
  AdminBookingsStackParamList,
  AdminCalendarStackParamList,
  AdminTabsParamList,
} from "../../navigation/types";

const SPORT_EMOJI: Record<string, string> = {
  CRICKET: "🏏",
  FOOTBALL: "⚽",
  PICKLEBALL: "🏓",
};

// Calendar lives inside its own stack inside the bottom tabs. From
// here we can navigate sideways to AdminSlotBlocks (within stack)
// and cross-tab to AdminBookings → AdminBookingDetail when a booking
// pill is tapped.
type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<AdminCalendarStackParamList, "AdminCalendar">,
  CompositeNavigationProp<
    BottomTabNavigationProp<AdminTabsParamList>,
    NativeStackNavigationProp<AdminBookingsStackParamList>
  >
>;

const SPORT_FILTERS: { value: AdminCalendarSport | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "CRICKET", label: "Cricket" },
  { value: "FOOTBALL", label: "Football" },
  { value: "PICKLEBALL", label: "Pickleball" },
];

/**
 * Mirrors the web /admin/calendar page. On mobile the orientation
 * flips: web shows hours as rows × courts as columns; we render one
 * card per court and lay the hours out as a horizontally scrolling
 * row of pills. Tap a booking pill to land on the booking detail —
 * same destination the web "External link" button hits.
 *
 * Empty cells render as a price-less, dim "free" pill rather than
 * being suppressed entirely, so a staffer can scan a court row and
 * see at a glance which slots are open.
 */
export function AdminCalendarScreen() {
  const navigation = useNavigation<Nav>();
  const today = getTodayIST();
  const [date, setDate] = useState<string>(today);
  const [sport, setSport] = useState<AdminCalendarSport | "">("");

  const query = useQuery({
    queryKey: ["admin-calendar", date, sport || "ALL"],
    queryFn: () =>
      adminCalendarApi.data(date, sport === "" ? undefined : sport),
    refetchOnWindowFocus: false,
  });

  const refreshing =
    (query.isFetching && !query.isLoading) || query.isRefetching;

  function shiftDay(offset: number) {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + offset);
    setDate(d.toISOString().split("T")[0]);
  }

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
        {/* Date stepper */}
        <View style={styles.dateBar}>
          <Pressable
            onPress={() => shiftDay(-1)}
            hitSlop={8}
            style={({ pressed }) => [
              styles.dateBtn,
              pressed && { opacity: 0.6 },
            ]}
          >
            <ChevronLeft size={16} color={colors.zinc300} />
          </Pressable>
          <View style={styles.dateLabel}>
            <CalendarDays size={14} color={colors.yellow400} />
            <Text variant="bodyStrong">{prettyDate(date)}</Text>
            {date !== today ? (
              <Pressable
                onPress={() => setDate(today)}
                hitSlop={8}
                style={styles.todayBtn}
              >
                <RotateCcw size={11} color={colors.zinc400} />
                <Text variant="tiny" color={colors.zinc400}>
                  Today
                </Text>
              </Pressable>
            ) : null}
          </View>
          <Pressable
            onPress={() => shiftDay(1)}
            hitSlop={8}
            style={({ pressed }) => [
              styles.dateBtn,
              pressed && { opacity: 0.6 },
            ]}
          >
            <ChevronRight size={16} color={colors.zinc300} />
          </Pressable>
        </View>

        {/* Manage blocks shortcut — same date context carries through
            via the stack params, but the slot-blocks screen has its
            own date stepper too so deep-linking isn't required. */}
        <Pressable
          onPress={() => navigation.navigate("AdminSlotBlocks")}
          style={({ pressed }) => [
            styles.manageBlocksBtn,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Settings2 size={14} color={colors.zinc300} />
          <Text variant="small" color={colors.zinc300} weight="600">
            Manage slot blocks
          </Text>
        </Pressable>

        {/* Sport filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {SPORT_FILTERS.map((s) => {
            const active = sport === s.value;
            return (
              <Pressable
                key={s.value || "ALL"}
                onPress={() => setSport(s.value)}
                style={({ pressed }) => [
                  styles.chip,
                  active && styles.chipActive,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text
                  variant="tiny"
                  color={active ? colors.yellow400 : colors.zinc300}
                  weight="600"
                >
                  {s.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Legend */}
        <View style={styles.legend}>
          <Legend color={colors.emerald400} label="Confirmed" />
          <Legend color={colors.yellow400} label="Pending" />
          <Legend color={colors.destructive} label="Blocked" />
          <Legend color={colors.zinc500} label="Free" />
        </View>

        {/* Body */}
        {query.isLoading ? (
          <CalendarSkeleton />
        ) : query.isError ? (
          <Pressable
            onPress={() => void query.refetch()}
            style={styles.errorBlock}
          >
            <Text variant="body" color={colors.destructive}>
              Couldn't load the calendar. Tap to retry.
            </Text>
            <Text variant="tiny" color={colors.zinc500}>
              {query.error instanceof Error
                ? query.error.message
                : "Unknown error"}
            </Text>
          </Pressable>
        ) : !query.data || query.data.configs.length === 0 ? (
          <View style={styles.empty}>
            <Text variant="bodyStrong" color={colors.zinc300}>
              No courts to show
            </Text>
            <Text variant="tiny" color={colors.zinc500} align="center">
              Try a different sport filter.
            </Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {query.data.configs.map((config) => (
              <CourtRow
                key={config.id}
                config={config}
                hours={query.data!.hours}
                cells={query.data!.grid[config.id] || {}}
                onPressBooking={(bookingId) =>
                  navigation.navigate("AdminBookings", {
                    screen: "AdminBookingDetail",
                    params: { bookingId },
                  })
                }
              />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function CourtRow({
  config,
  hours,
  cells,
  onPressBooking,
}: {
  config: CalendarConfig;
  hours: number[];
  cells: Record<number, CellData>;
  onPressBooking: (id: string) => void;
}) {
  const stats = useMemo(() => {
    let booked = 0;
    let blocked = 0;
    for (const h of hours) {
      const c = cells[h];
      if (!c) continue;
      if (c.booking) booked += 1;
      if (c.blocked) blocked += 1;
    }
    return { booked, blocked, free: hours.length - booked - blocked };
  }, [hours, cells]);

  return (
    <View style={styles.courtCard}>
      <View style={styles.courtHead}>
        <Text variant="bodyStrong">
          {SPORT_EMOJI[config.sport] ?? "🎯"} {sportLabel(config.sport)} ·{" "}
          {config.label}
        </Text>
        <Text variant="tiny" color={colors.zinc500}>
          {stats.booked} booked · {stats.blocked} blocked · {stats.free} free
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.hourRow}
      >
        {hours.map((h) => {
          const cell = cells[h];
          return (
            <HourPill
              key={h}
              hour={h}
              cell={cell}
              onPress={
                cell?.booking
                  ? () => onPressBooking(cell.booking!.id)
                  : undefined
              }
            />
          );
        })}
      </ScrollView>
    </View>
  );
}

function HourPill({
  hour,
  cell,
  onPress,
}: {
  hour: number;
  cell?: CellData;
  onPress?: () => void;
}) {
  const isBooking = !!cell?.booking;
  const isBlocked = !!cell?.blocked;
  const isPending = cell?.booking?.status === "PENDING";

  let borderColor = colors.zinc800;
  let backgroundColor = colors.zinc900;
  let labelColor = colors.zinc500;
  let icon: ReactNode = null;
  let secondary = "Free";

  if (isBooking) {
    if (isPending) {
      borderColor = "rgba(250, 204, 21, 0.40)";
      backgroundColor = "rgba(250, 204, 21, 0.10)";
      labelColor = colors.yellow400;
    } else {
      borderColor = "rgba(34, 197, 94, 0.40)";
      backgroundColor = "rgba(34, 197, 94, 0.10)";
      labelColor = colors.emerald400;
    }
    secondary = cell!.booking!.userName;
  } else if (isBlocked) {
    borderColor = "rgba(239, 68, 68, 0.30)";
    backgroundColor = "rgba(239, 68, 68, 0.10)";
    labelColor = colors.destructive;
    icon = <Lock size={10} color={colors.destructive} />;
    secondary = cell!.blockReason || "Blocked";
  }

  const inner = (
    <>
      <View style={styles.pillTop}>
        {icon}
        <Text variant="tiny" color={labelColor} weight="600">
          {formatHourCompact(hour)}
        </Text>
      </View>
      <Text
        variant="tiny"
        color={labelColor}
        numberOfLines={1}
        style={styles.pillSecondary}
      >
        {secondary}
      </Text>
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.pill,
          { borderColor, backgroundColor },
          pressed && { opacity: 0.7 },
        ]}
      >
        {inner}
      </Pressable>
    );
  }
  return (
    <View style={[styles.pill, { borderColor, backgroundColor }]}>
      {inner}
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text variant="tiny" color={colors.zinc400}>
        {label}
      </Text>
    </View>
  );
}

function CalendarSkeleton() {
  return (
    <View style={styles.grid}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.courtCard}>
          <Skeleton width="60%" height={14} />
          <Skeleton width="40%" height={11} />
          <View style={styles.hourRow}>
            {[0, 1, 2, 3, 4, 5].map((j) => (
              <Skeleton key={j} width={64} height={48} rounded="md" />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function prettyDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  dateBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  dateBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.background,
  },
  dateLabel: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["2"],
  },
  todayBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc800,
  },
  chipRow: {
    flexDirection: "row",
    gap: spacing["2"],
    paddingVertical: spacing["1"],
  },
  manageBlocksBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["1.5"],
    paddingVertical: spacing["2.5"],
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
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
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["3"],
    paddingHorizontal: spacing["1"],
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  grid: { gap: spacing["3"] },
  courtCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["3"],
    gap: spacing["2"],
  },
  courtHead: { gap: 2 },
  hourRow: { flexDirection: "row", gap: spacing["1.5"] },
  pill: {
    width: 72,
    paddingVertical: spacing["1.5"],
    paddingHorizontal: spacing["2"],
    borderRadius: 8,
    borderWidth: 1,
    gap: 2,
  },
  pillTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  pillSecondary: {
    fontSize: 9,
  },
  empty: {
    alignItems: "center",
    gap: spacing["1"],
    padding: spacing["6"],
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
});
