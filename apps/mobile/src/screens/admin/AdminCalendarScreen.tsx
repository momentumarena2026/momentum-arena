import { useMemo, useState } from "react";
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
  type CalendarData,
} from "../../lib/admin-calendar";
import { formatHourCompact, sportLabel } from "../../lib/format";
import { getTodayIST } from "../../lib/ist-date";
import type {
  AdminBookingsStackParamList,
  AdminCalendarStackParamList,
  AdminTabsParamList,
} from "../../navigation/types";

// Per-sport visual palette — used both for the chip background inside
// each cell and as the at-a-glance legend at the top. Mirrors the web
// admin's accent colours so the two surfaces feel consistent.
const SPORT_STYLE: Record<
  AdminCalendarSport,
  { emoji: string; bg: string; border: string; fg: string }
> = {
  CRICKET: {
    emoji: "🏏",
    bg: "rgba(34, 197, 94, 0.12)",
    border: "rgba(34, 197, 94, 0.40)",
    fg: colors.emerald400,
  },
  FOOTBALL: {
    emoji: "⚽",
    bg: "rgba(59, 130, 246, 0.12)",
    border: "rgba(59, 130, 246, 0.40)",
    fg: "#60a5fa",
  },
  PICKLEBALL: {
    emoji: "🏓",
    bg: "rgba(168, 85, 247, 0.14)",
    border: "rgba(168, 85, 247, 0.40)",
    fg: "#c084fc",
  },
};

// Calendar lives inside its own stack inside the bottom tabs. From
// here we navigate sideways to AdminSlotBlocks (within stack) and
// cross-tab to AdminBookings → AdminBookingDetail when a booking chip
// is tapped.
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
 * Calendar-style hour grid for a single date.
 *
 * Header shows the chosen date as "29 Apr Wed". Each cell represents
 * one hour slot ("5am - 6am") and surfaces a chip per booking that
 * occupies that hour, coloured by sport. Empty hours render as a
 * blank cell with only the time label, so floor staff can see at a
 * glance which hours are still free.
 *
 * Tap a chip to deep-link into AdminBookingDetail (cross-tab into
 * the Bookings stack). Tap "Manage slot blocks" to push the
 * SlotBlocks editor within this same Calendar tab.
 *
 * The data shape coming back from /api/mobile/admin/calendar is
 * `configId → hour → CellData` (a per-court grid). We pivot it here
 * into `hour → list of bookings` because the mobile view doesn't
 * have a per-court column — bookings from any court that overlaps
 * a given hour appear in the same hour cell, with the courtConfig
 * label inside the chip's secondary line.
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

  // Pivot configId×hour grid into a flat hour-keyed map of bookings,
  // each tagged with the court that owns it (so the chip can show
  // "🏏 Cricket · Full Field" for staff who need to know which court
  // the entry is on). Memoised because the pivot iterates every
  // configured hour × court.
  const hourMap = useMemo(() => buildHourMap(query.data ?? null), [
    query.data,
  ]);

  function shiftDay(offset: number) {
    // UTC arithmetic — `new Date("YYYY-MM-DDT00:00:00")` is local
    // time, so toISOString() shifts the date by the local TZ offset
    // (IST = +5:30) and the resulting YYYY-MM-DD lands a day off.
    // Anchoring at UTC midnight + setUTCDate keeps the string stable.
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + offset);
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
        {/* Header — replaces "January 2015" with the chosen date.
            Centered over the prev/next steppers like the reference
            calendar's month title. */}
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
            <CalendarDays size={16} color={colors.yellow400} />
            <Text variant="title" style={styles.dateTitle}>
              {prettyDate(date)}
            </Text>
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

        {/* Manage slot blocks shortcut — same Calendar tab stack. */}
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
        ) : !query.data || query.data.hours.length === 0 ? (
          <View style={styles.empty}>
            <Text variant="bodyStrong" color={colors.zinc300}>
              Nothing to show
            </Text>
            <Text variant="tiny" color={colors.zinc500} align="center">
              Try a different date or sport filter.
            </Text>
          </View>
        ) : (
          <HourGrid
            hours={query.data.hours}
            hourMap={hourMap}
            onPressBooking={(bookingId) =>
              navigation.navigate("AdminBookings", {
                screen: "AdminBookingDetail",
                params: { bookingId },
              })
            }
          />
        )}
      </ScrollView>
    </Screen>
  );
}

// ──────────────────────────────────────────────────────────────────
// Hour grid

interface HourEntry {
  bookings: Array<{
    id: string;
    sport: AdminCalendarSport;
    status: "CONFIRMED" | "PENDING";
    courtLabel: string;
  }>;
  blocks: Array<{ courtLabel: string; reason?: string }>;
}

function buildHourMap(data: CalendarData | null): Map<number, HourEntry> {
  const map = new Map<number, HourEntry>();
  if (!data) return map;
  for (const h of data.hours) map.set(h, { bookings: [], blocks: [] });

  for (const config of data.configs) {
    const row = data.grid[config.id] ?? {};
    for (const [hStr, cell] of Object.entries(row)) {
      const h = Number(hStr);
      const entry = map.get(h);
      if (!entry) continue;
      if (cell.booking) {
        // Multiple courts may register the same booking when zones
        // overlap. Dedup by booking id so the cell renders one chip
        // per booking rather than one per court the booking touches.
        if (!entry.bookings.some((b) => b.id === cell.booking!.id)) {
          entry.bookings.push({
            id: cell.booking.id,
            sport: config.sport,
            status: cell.booking.status,
            courtLabel: config.label,
          });
        }
      }
      if (cell.blocked) {
        entry.blocks.push({ courtLabel: config.label, reason: cell.blockReason });
      }
    }
  }
  return map;
}

function HourGrid({
  hours,
  hourMap,
  onPressBooking,
}: {
  hours: number[];
  hourMap: Map<number, HourEntry>;
  onPressBooking: (id: string) => void;
}) {
  return (
    <View style={styles.grid}>
      {hours.map((h) => {
        const entry = hourMap.get(h);
        return (
          <View key={h} style={styles.cell}>
            {/* Time label — replaces the date number from the
                reference calendar layout. */}
            <Text variant="tiny" color={colors.zinc500} weight="600">
              {formatHourCompact(h)} – {formatHourCompact(h + 1)}
            </Text>
            <View style={styles.cellBody}>
              {entry?.blocks.length ? (
                <View style={styles.blockedChip}>
                  <Lock size={10} color={colors.destructive} />
                  <Text
                    variant="tiny"
                    color={colors.destructive}
                    weight="600"
                    numberOfLines={1}
                  >
                    Blocked
                  </Text>
                </View>
              ) : null}
              {entry?.bookings.map((b) => (
                <Pressable
                  key={b.id}
                  onPress={() => onPressBooking(b.id)}
                  style={({ pressed }) => [
                    styles.sportChip,
                    {
                      backgroundColor: SPORT_STYLE[b.sport].bg,
                      borderColor: SPORT_STYLE[b.sport].border,
                      // PENDING bookings get a dashed border to call
                      // out that they're not yet confirmed — easy to
                      // spot when scanning a packed grid.
                      borderStyle: b.status === "PENDING" ? "dashed" : "solid",
                    },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text
                    variant="tiny"
                    color={SPORT_STYLE[b.sport].fg}
                    weight="600"
                    numberOfLines={1}
                  >
                    {SPORT_STYLE[b.sport].emoji} {sportLabel(b.sport)}
                  </Text>
                  <Text
                    variant="tiny"
                    color={SPORT_STYLE[b.sport].fg}
                    numberOfLines={1}
                    style={styles.sportChipMeta}
                  >
                    {b.courtLabel}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function CalendarSkeleton() {
  return (
    <View style={styles.grid}>
      {Array.from({ length: 12 }).map((_, i) => (
        <View key={i} style={styles.cell}>
          <Skeleton width="60%" height={11} />
          <Skeleton width="100%" height={28} rounded="md" />
        </View>
      ))}
    </View>
  );
}

function prettyDate(dateStr: string): string {
  // Renders "29 Apr Wed" — replaces the reference image's "January
  // 2015" header.
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    weekday: "short",
    timeZone: "Asia/Kolkata",
  });
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["3"],
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
  // Bigger than the regular bodyStrong so the date headline reads
  // like a calendar's month label.
  dateTitle: { fontSize: 18, fontWeight: "700", color: colors.foreground },
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
  chipRow: {
    flexDirection: "row",
    gap: spacing["2"],
    paddingVertical: spacing["1"],
    paddingHorizontal: spacing["2"],
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
  // 3-column grid with `gap` between cells. Cell width is held at
  // 32% (just under 100/3) so three side-by-side fit with the gap
  // above without spilling onto the next row. Operating hours 5..24
  // (20 slots) fill ~7 rows — fits a single mobile scroll.
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["1.5"],
  },
  cell: {
    // 3 columns → cell ≈ 32.5% wide. We use a fractional percentage
    // so RN's layout engine can fit three side-by-side with the
    // parent gap above without overflowing onto the next row.
    width: "32%",
    minHeight: 88,
    padding: spacing["2"],
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    gap: 4,
  },
  cellBody: {
    flex: 1,
    gap: 4,
  },
  sportChip: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    gap: 1,
  },
  sportChipMeta: {
    fontSize: 9,
    opacity: 0.85,
  },
  blockedChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing["2"],
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.30)",
    backgroundColor: "rgba(239, 68, 68, 0.10)",
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

