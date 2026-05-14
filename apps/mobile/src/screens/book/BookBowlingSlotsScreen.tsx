import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { NativeStackNavigationProp as RootNavType } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Check, Clock, Lock } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  bookingApi,
  type BowlingSlotAvailability,
} from "../../lib/booking";
import { ApiError } from "../../lib/api";
import { formatRupees, sportLabel } from "../../lib/format";
import {
  formatDateIST,
  getTodayIST,
  getUpcomingDatesIST,
} from "../../lib/ist-date";
import { useAuth } from "../../providers/AuthProvider";
import type {
  BookStackParamList,
  RootStackParamList,
} from "../../navigation/types";

type Nav = NativeStackNavigationProp<BookStackParamList, "BookBowlingSlots">;
type Rt = RouteProp<BookStackParamList, "BookBowlingSlots">;

const DATE_WINDOW_DAYS = 30;

// Encode hour+minute as a comparable integer for adjacency + sort.
function slotIndex(hour: number, minute: number) {
  return hour * 2 + (minute === 30 ? 1 : 0);
}

function keyOf(hour: number, minute: number) {
  return `${hour}:${minute}`;
}

// Render a 30-min slot as a range (e.g. "6:00 - 6:30 AM") to mirror
// the cricket/football tiles. When the slot straddles noon/midnight
// the two halves carry different meridiems so we surface both
// ("11:30 AM - 12:00 PM").
function fmtTime(hour: number, minute: number) {
  const endTotalMin = hour * 60 + minute + 30;
  const endH = Math.floor(endTotalMin / 60);
  const endM = endTotalMin % 60;
  const clock = (hr: number, min: number) => {
    const hh = hr % 24;
    const display = hh % 12 === 0 ? 12 : hh % 12;
    return `${display}:${min.toString().padStart(2, "0")}`;
  };
  const meridiem = (hr: number) => ((hr % 24) < 12 ? "AM" : "PM");
  const startMer = meridiem(hour);
  const endMer = meridiem(endH);
  return startMer === endMer
    ? `${clock(hour, minute)} - ${clock(endH, endM)} ${endMer}`
    : `${clock(hour, minute)} ${startMer} - ${clock(endH, endM)} ${endMer}`;
}

/**
 * Bowling-Machine 30-minute slot picker — mobile parallel of
 * `app/book/[sport]/[configId]/bowling-slot-picker-client.tsx`.
 *
 * Same rules: consecutive picks only, clicking a non-adjacent tile
 * collapses the selection to just the new tile (friendlier than a
 * silent reject).
 */
export function BookBowlingSlotsScreen() {
  const { params } = useRoute<Rt>();
  const navigation = useNavigation<Nav>();
  const { state } = useAuth();

  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayIST());
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [locking, setLocking] = useState(false);

  const pickDate = useCallback((dateStr: string) => {
    setSelectedDate(dateStr);
    setSelectedKeys(new Set());
  }, []);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["bowling-availability", params.courtConfigId, selectedDate],
    queryFn: () =>
      bookingApi.bowlingAvailability(params.courtConfigId, selectedDate),
  });

  const slots: BowlingSlotAvailability[] = data?.slots ?? [];

  const sortedSelected = useMemo(() => {
    return Array.from(selectedKeys)
      .map((k) => {
        const [h, m] = k.split(":").map(Number);
        return { hour: h, minute: (m === 30 ? 30 : 0) as 0 | 30 };
      })
      .sort((a, b) => slotIndex(a.hour, a.minute) - slotIndex(b.hour, b.minute));
  }, [selectedKeys]);

  const total = useMemo(
    () =>
      sortedSelected.reduce((sum, s) => {
        const found = slots.find(
          (x) => x.hour === s.hour && x.minute === s.minute,
        );
        return sum + (found?.price ?? 0);
      }, 0),
    [sortedSelected, slots],
  );

  function toggleSlot(slot: BowlingSlotAvailability) {
    if (slot.status !== "available") return;
    const k = keyOf(slot.hour, slot.minute);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) {
        next.delete(k);
        return next;
      }
      next.add(k);
      const indices = Array.from(next)
        .map((s) => {
          const [h, m] = s.split(":").map(Number);
          return slotIndex(h, m);
        })
        .sort((a, b) => a - b);
      const isContiguous = indices.every(
        (v, i) => i === 0 || v === indices[i - 1] + 1,
      );
      if (!isContiguous) {
        return new Set([k]);
      }
      return next;
    });
  }

  async function handleContinue() {
    if (!state || state.status !== "signedIn") {
      const rootNav = navigation.getParent<RootNavType<RootStackParamList>>();
      rootNav?.navigate("Phone");
      return;
    }
    if (sortedSelected.length === 0) return;
    setLocking(true);
    try {
      const res = await bookingApi.lock({
        mode: "bowling-machine",
        courtConfigId: params.courtConfigId,
        date: selectedDate,
        slots: sortedSelected,
      });
      if (!res.success || !res.holdId) {
        Alert.alert(
          "Slot unavailable",
          res.error || "Those slots were just taken — please pick again.",
        );
        await refetch();
        setSelectedKeys(new Set());
        return;
      }
      navigation.navigate("Checkout", { holdId: res.holdId });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Network error — try again.";
      Alert.alert("Couldn't continue", message);
    } finally {
      setLocking(false);
    }
  }

  const signedIn = state.status === "signedIn";

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.primary}
          />
        }
      >
        <View style={styles.header}>
          <Text variant="tiny" color={colors.primary} style={styles.kicker}>
            {sportLabel(params.sport).toUpperCase()}
          </Text>
          <Text variant="title">{params.courtLabel}</Text>
          <Text variant="small" color={colors.mutedForeground}>
            Pick consecutive 30-minute slots.
          </Text>
        </View>

        <View style={styles.section}>
          <View style={styles.dateHeader}>
            <CalendarDays size={16} color={colors.zinc400} />
            <Text variant="small" color={colors.zinc400}>
              Select Date
            </Text>
          </View>
          <DateStrip selectedDate={selectedDate} onDateChange={pickDate} />
        </View>

        <View style={styles.section}>
          <View style={styles.dateHeader}>
            <Clock size={16} color={colors.zinc400} />
            <Text variant="small" color={colors.zinc400}>
              Select Time
            </Text>
          </View>

          {isLoading ? (
            <View style={styles.skeletonGrid}>
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton
                  key={i}
                  width="31%"
                  height={48}
                  rounded="lg"
                  style={styles.skeletonTile}
                />
              ))}
            </View>
          ) : isError ? (
            <Card>
              <Text variant="body" color={colors.mutedForeground}>
                Couldn't load slots. Pull to retry.
              </Text>
            </Card>
          ) : slots.length === 0 ? (
            <Card>
              <Text variant="bodyStrong">No bowling slots today</Text>
              <Text
                variant="small"
                color={colors.mutedForeground}
                style={styles.empty}
              >
                The bowling-machine isn't operating in this window. Try
                another date.
              </Text>
            </Card>
          ) : (
            <View style={styles.slotsGrid}>
              {slots.map((slot) => {
                const k = keyOf(slot.hour, slot.minute);
                const isSelected = selectedKeys.has(k);
                const isAvail = slot.status === "available";
                return (
                  <Pressable
                    key={k}
                    onPress={() => toggleSlot(slot)}
                    disabled={!isAvail}
                    style={({ pressed }) => [
                      styles.slot,
                      isSelected
                        ? styles.slotSelected
                        : isAvail
                          ? styles.slotAvailable
                          : styles.slotUnavailable,
                      pressed && isAvail && { opacity: 0.85 },
                    ]}
                  >
                    <View style={styles.slotHeader}>
                      <Text
                        variant="small"
                        weight="600"
                        color={
                          isAvail || isSelected
                            ? colors.foreground
                            : colors.zinc500
                        }
                      >
                        {fmtTime(slot.hour, slot.minute)}
                      </Text>
                      {isSelected ? (
                        <Check size={14} color={colors.emerald400} />
                      ) : null}
                    </View>
                    <Text
                      variant="tiny"
                      color={isAvail ? colors.zinc400 : colors.zinc600}
                    >
                      {isAvail
                        ? formatRupees(slot.price)
                        : slot.status === "booked"
                          ? "Booked"
                          : slot.status === "locked"
                            ? "Holding"
                            : "Unavailable"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {sortedSelected.length > 0 ? (
          <View style={styles.summaryCard}>
            <View>
              <Text variant="small" color={colors.zinc400}>
                {sortedSelected.length} × 30 min
              </Text>
              <Text
                variant="tiny"
                color={colors.zinc500}
                style={styles.summarySub}
              >
                {sortedSelected.length * 30} min total
              </Text>
            </View>
            <Text variant="heading" weight="700" color={colors.emerald400}>
              {formatRupees(total)}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.footerBody}>
          <Text variant="small" color={colors.mutedForeground}>
            {sortedSelected.length === 0
              ? "Pick consecutive 30-min slots"
              : `${sortedSelected.length} × 30 min`}
          </Text>
          <Text variant="heading" color={colors.primary}>
            {total > 0 ? formatRupees(total) : "—"}
          </Text>
        </View>
        <Button
          label={signedIn ? "Continue" : "Sign in to continue"}
          onPress={handleContinue}
          disabled={sortedSelected.length === 0}
          loading={locking}
          size="lg"
          leadingIcon={
            !signedIn ? (
              <Lock size={18} color={colors.primaryForeground} />
            ) : undefined
          }
          fullWidth
        />
      </View>
    </Screen>
  );
}

function DateStrip({
  selectedDate,
  onDateChange,
}: {
  selectedDate: string;
  onDateChange: (dateStr: string) => void;
}) {
  const dateStrings = useMemo(() => getUpcomingDatesIST(DATE_WINDOW_DAYS), []);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.dateRow}
    >
      {dateStrings.map((dateStr) => {
        const info = formatDateIST(dateStr);
        const isSelected = selectedDate === dateStr;
        return (
          <Pressable
            key={dateStr}
            onPress={() => onDateChange(dateStr)}
            style={({ pressed }) => [
              styles.dateCell,
              isSelected && styles.dateCellSelected,
              pressed && !isSelected && { opacity: 0.85 },
            ]}
          >
            <Text
              variant="tiny"
              weight="500"
              color={
                isSelected
                  ? colors.emerald400
                  : info.isWeekend
                    ? colors.yellow400
                    : colors.zinc500
              }
            >
              {info.dayName}
            </Text>
            <Text
              variant="heading"
              weight="700"
              color={isSelected ? colors.foreground : colors.zinc300}
              style={styles.dateNum}
            >
              {info.date}
            </Text>
            <Text variant="tiny" color={colors.zinc500}>
              {info.month}
            </Text>
            {info.isToday ? (
              <Text
                variant="tiny"
                weight="500"
                color={colors.emerald500}
                style={styles.todayLabel}
              >
                Today
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["6"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["6"],
  },
  header: {
    gap: spacing["1.5"],
    marginBottom: spacing["5"],
  },
  kicker: {
    letterSpacing: 1.5,
    fontWeight: "700",
  },
  section: {
    marginTop: spacing["4"],
    gap: spacing["3"],
  },
  dateHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  dateRow: {
    flexDirection: "row",
    gap: spacing["2"],
    paddingBottom: spacing["2"],
  },
  dateCell: {
    minWidth: 70,
    alignItems: "center",
    paddingVertical: spacing["3"],
    paddingHorizontal: spacing["2"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  dateCellSelected: {
    borderColor: colors.emerald400,
    backgroundColor: colors.emerald500_20,
    borderWidth: 2,
  },
  dateNum: {
    fontSize: 20,
    lineHeight: 24,
  },
  todayLabel: {
    marginTop: 2,
    fontSize: 10,
  },
  skeletonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["2"],
  },
  skeletonTile: {
    marginBottom: 0,
  },
  slotsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["2"],
  },
  slot: {
    width: "31%",
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing["2.5"],
    gap: 2,
  },
  slotAvailable: {
    backgroundColor: colors.emerald500_10,
    borderColor: colors.emerald500_30,
  },
  slotUnavailable: {
    backgroundColor: colors.zinc800_50,
    borderColor: colors.zinc700,
    opacity: 0.5,
  },
  slotSelected: {
    backgroundColor: colors.emerald500_20,
    borderColor: colors.emerald400,
    borderWidth: 2,
  },
  slotHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  empty: {
    marginTop: spacing["1"],
  },
  summaryCard: {
    marginTop: spacing["5"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_05,
    padding: spacing["4"],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  summarySub: {
    marginTop: 2,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing["6"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["5"],
    backgroundColor: colors.background,
    gap: spacing["3"],
  },
  footerBody: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
