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
import { GearPicker } from "../../components/booking/GearPicker";
import { ApiError } from "../../lib/api";
import { formatRupees, sportLabel } from "../../lib/format";
import {
  trackDateChanged,
  trackLockFailed,
  trackLockSuccess,
  trackProceedToCheckout,
  trackSlotToggled,
} from "../../lib/analytics";
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
  // Rental gear picks captured pre-lock — see BookSlotsScreen for the
  // same pattern. Sent into bookingApi.lock so the hold snapshots
  // equipment at lock time.
  const [selectedEquipment, setSelectedEquipment] = useState<Set<string>>(
    new Set(),
  );
  const [locking, setLocking] = useState(false);

  // Bowling-machine equipment options. Category is fixed —
  // BOWLING_MACHINE — so the catalog returns kit / bat / L-guard.
  const equipmentQuery = useQuery({
    queryKey: ["equipment", params.sport, "BOWLING_MACHINE"],
    queryFn: () =>
      bookingApi.listEquipment({
        sport: params.sport,
        category: "BOWLING_MACHINE",
      }),
    staleTime: 60_000,
  });
  const equipmentOptions = equipmentQuery.data?.equipment ?? [];

  const pickDate = useCallback((dateStr: string) => {
    trackDateChanged(dateStr);
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

  const slotTotal = useMemo(
    () =>
      sortedSelected.reduce((sum, s) => {
        const found = slots.find(
          (x) => x.hour === s.hour && x.minute === s.minute,
        );
        return sum + (found?.price ?? 0);
      }, 0),
    [sortedSelected, slots],
  );

  // Rental gear add-on — per-slot rate × slot count. Mirror of the
  // web bowling-slot-picker-client math so the customer sees the same
  // price on either platform.
  const rentalTotal = useMemo(() => {
    return Array.from(selectedEquipment).reduce((sum, id) => {
      const opt = equipmentOptions.find((o) => o.id === id);
      if (!opt) return sum;
      return sum + Math.round(opt.pricePaise / 100) * sortedSelected.length;
    }, 0);
  }, [selectedEquipment, equipmentOptions, sortedSelected.length]);

  const total = slotTotal + rentalTotal;

  function toggleSlot(slot: BowlingSlotAvailability) {
    if (slot.status !== "available") return;
    const k = keyOf(slot.hour, slot.minute);
    trackSlotToggled(selectedKeys.has(k) ? "remove" : "add", slot.hour, slot.price);
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
    trackProceedToCheckout(sortedSelected.length, total, false);
    setLocking(true);
    try {
      const equipmentSelection =
        selectedEquipment.size > 0
          ? Array.from(selectedEquipment).map((id) => ({
              equipmentId: id,
              quantity: 1,
            }))
          : undefined;
      const res = await bookingApi.lock({
        mode: "bowling-machine",
        courtConfigId: params.courtConfigId,
        date: selectedDate,
        slots: sortedSelected,
        equipmentSelection,
      });
      if (!res.success || !res.holdId) {
        trackLockFailed(res.error || "Those slots were just taken");
        Alert.alert(
          "Slot unavailable",
          res.error || "Those slots were just taken — please pick again.",
        );
        await refetch();
        setSelectedKeys(new Set());
        return;
      }
      trackLockSuccess(res.holdId);
      navigation.navigate("Checkout", { holdId: res.holdId });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Network error — try again.";
      trackLockFailed(message);
      Alert.alert("Couldn't continue", message);
    } finally {
      setLocking(false);
    }
  }

  const signedIn = state.status === "signedIn";

  return (
    <Screen padded={false} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        // Pin the date-picker section (index 1) so the customer
        // keeps the day strip in reach while scrolling 30-min
        // slots. Same treatment as the hourly BookSlotsScreen so
        // both pickers feel identical on scroll.
        stickyHeaderIndices={[1]}
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

        <View style={styles.stickyDateSection}>
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
            // Width + height intentionally match the live tile grid
            // below (`slot` style — 2 columns at 48.5% width, ~56px
            // tall after padding). Used to be 3-col 31% which lied
            // about the layout and made the page jump on data arrival.
            <View style={styles.skeletonGrid}>
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton
                  key={i}
                  width="48.5%"
                  height={56}
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
                const isBooked =
                  slot.status === "booked" || slot.status === "locked";
                const isPast = slot.status === "closed";
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
                          : isBooked
                            ? styles.slotBookedFuture
                            : styles.slotUnavailable,
                      pressed && isAvail && { opacity: 0.85 },
                    ]}
                  >
                    {/* Tile structure mirrors the hourly BookSlotsScreen
                        exactly so the two pickers read as the same
                        component. Clock icon + time-range, with a
                        Check on selected. Footer below shows price
                        when available, status label otherwise. */}
                    <View style={styles.slotHeader}>
                      <View style={styles.slotTimeRow}>
                        <Clock size={12} color={colors.zinc500} />
                        {/* Single-line + auto-shrink so the longer
                            "9:30am - 10am" string never wraps to two
                            lines (the visible bug). Tile height stays
                            uniform with the hourly BookSlotsScreen. */}
                        <Text
                          variant="small"
                          weight="500"
                          color={colors.foreground}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          style={styles.slotTimeText}
                        >
                          {fmtTime(slot.hour, slot.minute)}
                        </Text>
                      </View>
                      {isSelected ? (
                        <Check size={16} color={colors.emerald400} />
                      ) : null}
                    </View>
                    <Text
                      variant="tiny"
                      color={
                        isAvail
                          ? colors.zinc400
                          : isBooked
                            ? colors.destructive_300
                            : colors.zinc500
                      }
                      style={styles.slotFooter}
                    >
                      {isAvail
                        ? formatRupees(slot.price)
                        : isBooked
                          ? "Booked"
                          : isPast
                            ? "Past"
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
        {/* Gear picker — auto-expands the first time the user picks a
            30-min slot. Hidden until then so the slot grid above stays
            in view on first load. */}
        {sortedSelected.length > 0 && equipmentOptions.length > 0 && (
          <GearPicker
            options={equipmentOptions}
            selectedIds={selectedEquipment}
            onChange={setSelectedEquipment}
            slotCount={sortedSelected.length}
          />
        )}
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
  // Sticky variant of `section` — same vertical rhythm plus an
  // opaque background and a hairline divider so slot tiles
  // don't bleed through when the date row is pinned to the top.
  // `gap` sits at 24 (was 12 → 20 → 24) so the "Select Date" label
  // has clear breathing room above the date strip (mirror of the
  // hourly BookSlotsScreen tweak — kept in lockstep so the two
  // screens feel identical; 20 still read as clinging on device).
  stickyDateSection: {
    marginTop: spacing["4"],
    gap: spacing["6"],
    backgroundColor: colors.background,
    paddingBottom: spacing["3"],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  dateHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    // Extra air under the section labels — mirror of BookSlotsScreen.
    marginBottom: spacing["2"],
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
  // Grid + tile dimensions intentionally match the hourly
  // BookSlotsScreen so cricket / football / pickleball / bowling
  // all render the same tile shape. Going from 3-col 31% width
  // (old bowling) to 2-col 48.5% gives the time + Clock icon room
  // to breathe and matches the muscle memory from the other
  // sports.
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
  // Booked tile — same red palette the hourly grid uses for
  // "booked but still in the future". Bowling has no waitlist yet
  // so the Bell + "Notify me" affordance is intentionally absent,
  // but the color treatment matches so the two pickers feel like
  // one component.
  slotBookedFuture: {
    backgroundColor: colors.destructive_10,
    borderColor: colors.destructive_30,
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
    flex: 1,
    minWidth: 0,
  },
  // Mirror of BookSlotsScreen's slotTimeText — flexShrink lets the
  // auto-fit text shrink within the row instead of pushing the
  // Check/Bell icons off-screen.
  slotTimeText: {
    flexShrink: 1,
  },
  slotFooter: {
    marginTop: 2,
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
  // Symmetric 12/12 vertical padding — with the Screen's bottom
  // safe-area edge removed (tab bar owns that inset), 20 bottom read
  // as a tall dead zone under the Continue button.
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing["6"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["3"],
    backgroundColor: colors.background,
    gap: spacing["3"],
  },
  footerBody: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
