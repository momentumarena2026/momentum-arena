import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { colors, radius, spacing } from "../../theme";
import { bookingApi, type SlotAvailability } from "../../lib/booking";
import { ApiError } from "../../lib/api";
import {
  formatHourRangeCompact,
  formatHoursAsRanges,
  formatRupees,
  sportLabel,
} from "../../lib/format";
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

type Nav = NativeStackNavigationProp<BookStackParamList, "BookSlots">;
type Rt = RouteProp<BookStackParamList, "BookSlots">;

const MAX_CONSECUTIVE_HOURS = 6;
const DATE_WINDOW_DAYS = 30; // Web shows 30 days of scrollable dates.

export function BookSlotsScreen() {
  const { params } = useRoute<Rt>();
  const navigation = useNavigation<Nav>();
  const { state } = useAuth();

  // Track selectedDate as the IST "YYYY-MM-DD" string directly (web does the
  // same). Easier to compare against getTodayIST() and to pass to the API.
  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayIST());
  const [selected, setSelected] = useState<number[]>([]);
  const [locking, setLocking] = useState(false);

  const pickDate = useCallback((dateStr: string) => {
    setSelectedDate(dateStr);
    setSelected([]);
  }, []);

  // Either we know the specific court config (regular flow) or we're in
  // "medium" mode where the server decides which half-court gets assigned.
  const isMedium = params.mode === "medium";
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: isMedium
      ? (["availability", "medium", params.sport, selectedDate] as const)
      : (["availability", params.courtConfigId, selectedDate] as const),
    queryFn: () =>
      isMedium
        ? bookingApi.availability({
            mode: "medium",
            sport: params.sport,
            date: selectedDate,
          })
        : bookingApi.availability({
            configId: params.courtConfigId!,
            date: selectedDate,
          }),
  });

  const slots: SlotAvailability[] = data?.slots ?? [];

  const total = useMemo(
    () =>
      slots
        .filter((s) => selected.includes(s.hour))
        .reduce((sum, s) => sum + s.price, 0),
    [slots, selected]
  );

  function toggleHour(hour: number) {
    setSelected((prev) => {
      if (prev.includes(hour)) {
        return prev.filter((h) => h !== hour);
      }
      if (prev.length >= MAX_CONSECUTIVE_HOURS) {
        Alert.alert(
          "Max reached",
          `You can book up to ${MAX_CONSECUTIVE_HOURS} hours at a time.`
        );
        return prev;
      }
      const next = [...prev, hour].sort((a, b) => a - b);
      // Enforce contiguity — if the new set isn't a run of consecutive hours,
      // start a fresh selection with just this hour.
      for (let i = 1; i < next.length; i++) {
        if (next[i] !== next[i - 1] + 1) return [hour];
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
    if (selected.length === 0) return;
    setLocking(true);
    try {
      const res = await bookingApi.lock(
        isMedium
          ? {
              mode: "medium",
              sport: params.sport,
              date: selectedDate,
              hours: selected,
            }
          : {
              courtConfigId: params.courtConfigId!,
              date: selectedDate,
              hours: selected,
            }
      );
      if (!res.success || !res.holdId) {
        const msg = res.conflicts?.length
          ? `Hours ${res.conflicts
              .map((h) => formatHourRangeCompact(h))
              .join(", ")} were just booked. Please pick again.`
          : res.error || "Couldn't reserve the slot. Try again.";
        Alert.alert("Slot unavailable", msg);
        await refetch();
        setSelected([]);
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
            Pick a date and one or more consecutive hours.
          </Text>
        </View>

        {/* Date picker — horizontally scrollable 30-day strip, matching web. */}
        <View style={styles.section}>
          <View style={styles.dateHeader}>
            <CalendarDays size={16} color={colors.zinc400} />
            <Text variant="small" color={colors.zinc400}>
              Select Date
            </Text>
          </View>
          <DateStrip selectedDate={selectedDate} onDateChange={pickDate} />
        </View>

        {/* Slots — 2-column grid with "5pm - 6pm"-style labels. */}
        <View style={styles.section}>
          <View style={styles.dateHeader}>
            <Clock size={16} color={colors.zinc400} />
            <Text variant="small" color={colors.zinc400}>
              Select Time
            </Text>
          </View>
          {isLoading ? (
            <View style={styles.loader}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : isError ? (
            <Card>
              <Text variant="body" color={colors.mutedForeground}>
                Couldn't load availability. Pull to retry.
              </Text>
            </Card>
          ) : slots.length === 0 ? (
            <Card>
              <Text variant="body" color={colors.mutedForeground}>
                No slots published for this day yet.
              </Text>
            </Card>
          ) : (
            <SlotGrid
              slots={slots}
              selected={selected}
              onToggle={toggleHour}
            />
          )}
        </View>

        {/* Selection summary — mirrors web's summary card. */}
        {selected.length > 0 ? (
          <View style={styles.summaryCard}>
            <View>
              <Text variant="small" color={colors.zinc400}>
                {selected.length} slot{selected.length > 1 ? "s" : ""} selected
              </Text>
              <Text variant="tiny" color={colors.zinc500} style={styles.summarySub}>
                {formatHoursAsRanges(selected)}
              </Text>
            </View>
            <View style={styles.summaryTotal}>
              <Text
                variant="heading"
                color={colors.emerald400}
                style={styles.summaryAmount}
              >
                {formatRupees(total)}
              </Text>
              <Text variant="tiny" color={colors.zinc500}>
                Total
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* Sticky footer */}
      <View style={styles.footer}>
        <View style={styles.footerBody}>
          <Text variant="small" color={colors.mutedForeground}>
            {selected.length === 0
              ? "Pick one or more slots"
              : `${selected.length} × 1 hour · ${sportLabel(params.sport)}`}
          </Text>
          <Text variant="heading" color={colors.primary}>
            {total > 0 ? formatRupees(total) : "—"}
          </Text>
        </View>
        <Button
          label={signedIn ? "Continue" : "Sign in to continue"}
          onPress={handleContinue}
          disabled={selected.length === 0}
          loading={locking}
          size="lg"
          leadingIcon={
            !signedIn ? <Lock size={18} color={colors.primaryForeground} /> : undefined
          }
          fullWidth
        />
      </View>
    </Screen>
  );
}

/**
 * 30-day horizontally scrollable date strip.
 *
 * Matches web's `components/booking/date-picker.tsx`:
 *   - minWidth 70px tiles, 8px gap
 *   - selected: emerald-400 border + emerald-500/20 fill + emerald-400 ring
 *   - weekend day-name: yellow-400
 *   - "Today" label below today's tile
 */
function DateStrip({
  selectedDate,
  onDateChange,
}: {
  selectedDate: string;
  onDateChange: (dateStr: string) => void;
}) {
  const dateStrings = useMemo(
    () => getUpcomingDatesIST(DATE_WINDOW_DAYS),
    []
  );

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

/**
 * Two-column slot grid. Matches web's `components/booking/slot-grid.tsx`:
 * available tiles get emerald-500/10 bg + emerald-500/30 border, selected
 * tiles get emerald-500/20 bg + emerald-400 border + check icon, unavailable
 * tiles get zinc-800/50 bg + zinc-700 border and an "Unavailable" label.
 */
function SlotGrid({
  slots,
  selected,
  onToggle,
}: {
  slots: SlotAvailability[];
  selected: number[];
  onToggle: (hour: number) => void;
}) {
  return (
    <View style={styles.slotsGrid}>
      {slots.map((slot) => {
        const isSelected = selected.includes(slot.hour);
        const isAvailable = slot.status === "available";

        return (
          <Pressable
            key={slot.hour}
            onPress={() => isAvailable && onToggle(slot.hour)}
            disabled={!isAvailable}
            style={({ pressed }) => [
              styles.slot,
              isSelected
                ? styles.slotSelected
                : isAvailable
                ? styles.slotAvailable
                : styles.slotUnavailable,
              pressed && isAvailable && { opacity: 0.85 },
            ]}
          >
            <View style={styles.slotHeader}>
              <View style={styles.slotTimeRow}>
                <Clock size={14} color={colors.zinc500} />
                <Text variant="small" weight="500" color={colors.foreground}>
                  {formatHourRangeCompact(slot.hour)}
                </Text>
              </View>
              {isSelected ? (
                <Check size={16} color={colors.emerald400} />
              ) : null}
            </View>
            <Text
              variant="tiny"
              color={isAvailable ? colors.zinc400 : colors.zinc500}
              style={styles.slotFooter}
            >
              {isAvailable ? formatRupees(slot.price) : "Unavailable"}
            </Text>
          </Pressable>
        );
      })}
    </View>
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
    // Ring-1 ring-emerald-400/50 is approximated with a matching outer ring
    // via extra border width so the selection reads clearly in the dark UI.
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
  loader: {
    paddingVertical: spacing["8"],
    alignItems: "center",
  },
  slotsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["2"],
  },
  slot: {
    width: "48.5%",
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing["3"],
    gap: spacing["1"],
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
  slotTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  slotFooter: {
    marginTop: 2,
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
  summaryTotal: {
    alignItems: "flex-end",
  },
  summaryAmount: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "700",
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
