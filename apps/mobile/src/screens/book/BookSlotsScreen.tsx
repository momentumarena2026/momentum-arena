import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { env } from "../../config/env";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { NativeStackNavigationProp as RootNavType } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { Bell, BellRing, CalendarDays, Check, Clock, Lock, X } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import { bookingApi, type SlotAvailability } from "../../lib/booking";
import { GearPicker } from "../../components/booking/GearPicker";
import {
  type ActiveSportPromo,
  computeAutoApplyDiscount,
} from "../../lib/auto-apply-promo";
import { ApiError } from "../../lib/api";
import { waitlistApi } from "../../lib/waitlist";
import {
  trackSlotUnavailableTap,
  trackWaitlistJoinFailed,
  trackWaitlistJoined,
} from "../../lib/analytics";
import {
  formatHourRangeCompact,
  formatHoursAsRanges,
  formatRupees,
  sportLabel,
} from "../../lib/format";
import {
  formatDateIST,
  getCurrentHourIST,
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

const DATE_WINDOW_DAYS = 30; // Web shows 30 days of scrollable dates.

export function BookSlotsScreen() {
  const { params } = useRoute<Rt>();
  const navigation = useNavigation<Nav>();
  const { state } = useAuth();

  // Track selectedDate as the IST "YYYY-MM-DD" string directly (web does the
  // same). Easier to compare against getTodayIST() and to pass to the API.
  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayIST());
  const [selected, setSelected] = useState<number[]>([]);
  // Rental gear picks captured pre-lock — passed into bookingApi.lock
  // so the fresh hold lands in checkout with equipment already
  // snapshotted (replaces the in-checkout rental selector).
  const [selectedEquipment, setSelectedEquipment] = useState<Set<string>>(
    new Set(),
  );
  const [locking, setLocking] = useState(false);

  // Customer-facing equipment options for this sport. Category here is
  // null because hourly box bookings don't have a sub-category; the
  // BowlingSlotsScreen passes BOWLING_MACHINE on its own.
  const equipmentQuery = useQuery({
    queryKey: ["equipment", params.sport, null],
    queryFn: () => bookingApi.listEquipment({ sport: params.sport }),
    staleTime: 60_000,
  });
  const equipmentOptions = equipmentQuery.data?.equipment ?? [];
  // Waitlist sheet state — `null` = closed, hour value = open for that
  // slot. Only enabled in single-court mode (mediumMode lacks a stable
  // courtConfigId until lock time, same as web).
  const [waitlistHour, setWaitlistHour] = useState<number | null>(null);

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

  // Active auto-apply promo for this sport — drives the launch-offer
  // banner above the slot grid and the per-slot strike-through price
  // decoration. Same data the web slot page reads via getActiveSportPromo.
  // No bookingCategory passed here because the regular BookSlotsScreen
  // never handles bowling-machine flows (those go through
  // BookBowlingSlotsScreen) — so the category filter on the coupon side
  // (categoryExclude: [BOWLING_MACHINE]) is moot.
  const { data: promoData } = useQuery({
    queryKey: ["sport-promo", params.sport],
    queryFn: () => bookingApi.sportPromo(params.sport),
    // Stale-while-revalidate: a coupon's value rarely changes within a
    // session, but we still want the next visit to pick up admin edits.
    staleTime: 5 * 60 * 1000,
  });
  const promo: ActiveSportPromo | null = promoData?.promo ?? null;
  // Per-slot decoration only when the promo is an uncapped PERCENTAGE
  // (`percentOff` non-null). FLAT promos like FLAT100 apply once to the
  // whole order and would show misleading numbers per slot.
  const showDiscount = promo?.percentOff != null;

  const slotsOriginal = useMemo(
    () =>
      slots
        .filter((s) => selected.includes(s.hour))
        .reduce((sum, s) => sum + s.price, 0),
    [slots, selected]
  );
  const slotsDiscounted = useMemo(
    () =>
      showDiscount && promo
        ? slots
            .filter((s) => selected.includes(s.hour))
            .reduce(
              (sum, s) => sum + (s.price - computeAutoApplyDiscount(s.price, promo)),
              0,
            )
        : slotsOriginal,
    [showDiscount, promo, slots, selected, slotsOriginal]
  );

  // Rental gear add-on — per-slot rate × slot count, in whole rupees.
  // Folded into both totalOriginal + totalDiscounted so the footer
  // shows the customer exactly what the eventual checkout will charge
  // (mirror of the web slot-selection-client + bowling picker math).
  const rentalTotal = useMemo(() => {
    return Array.from(selectedEquipment).reduce((sum, id) => {
      const opt = equipmentOptions.find((o) => o.id === id);
      if (!opt) return sum;
      return sum + Math.round(opt.pricePaise / 100) * selected.length;
    }, 0);
  }, [selectedEquipment, equipmentOptions, selected.length]);

  // Keep the original variable names so the existing footer markup
  // (line-through promo display, discount comparison) reads the same
  // — just with gear rolled in.
  const totalOriginal = slotsOriginal + rentalTotal;
  const totalDiscounted = slotsDiscounted + rentalTotal;
  // Footer + lock summaries always show the price the user pays. Keep
  // the old `total` name so the rest of the screen reads the same.
  const total = totalDiscounted;

  // Toggle a slot in/out of the selection. Mirrors the web's
  // `components/booking/slot-grid.tsx` exactly — any combination of
  // available hours is allowed, no contiguity requirement and no UI
  // cap. The earlier mobile implementation silently dropped the
  // previous selection when the user tapped a non-consecutive hour,
  // which made multi-select look broken (tap 5pm, then 8pm — only
  // 8pm survived). The server doesn't enforce contiguity either, so
  // this is purely a UI rule that shouldn't have existed.
  function toggleHour(hour: number) {
    setSelected((prev) =>
      prev.includes(hour)
        ? prev.filter((h) => h !== hour)
        : [...prev, hour].sort((a, b) => a - b),
    );
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
      const equipmentSelection =
        selectedEquipment.size > 0
          ? Array.from(selectedEquipment).map((id) => ({
              equipmentId: id,
              quantity: 1,
            }))
          : undefined;
      const res = await bookingApi.lock(
        isMedium
          ? {
              mode: "medium",
              sport: params.sport,
              date: selectedDate,
              hours: selected,
              equipmentSelection,
            }
          : {
              courtConfigId: params.courtConfigId!,
              date: selectedDate,
              hours: selected,
              equipmentSelection,
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
        // Pin the date-picker section (index 1, right under the
        // course header) so the customer keeps the day strip in
        // reach while scrolling slots — matches the web sticky
        // date picker behavior on /book/[sport]/[configId].
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
            Pick a date and one or more consecutive hours.
          </Text>
        </View>

        {/* Date picker — horizontally scrollable 30-day strip,
            matching web. Sticky on scroll via the ScrollView's
            stickyHeaderIndices above. Background is opaque so
            slot tiles don't bleed through when the section is
            pinned. */}
        <View style={styles.stickyDateSection}>
          <View style={styles.dateHeader}>
            <CalendarDays size={16} color={colors.zinc400} />
            <Text variant="small" color={colors.zinc400}>
              Select Date
            </Text>
          </View>
          <DateStrip selectedDate={selectedDate} onDateChange={pickDate} />
        </View>

        {/* Launch-offer banner image. The designer banner already
            carries the "25% OFF · auto-applied at checkout" copy and
            the morning/night price chips, so a parallel text card
            would be redundant. Still gated on the live PICKLEBALL25
            coupon — when admin disables/expires it server-side, this
            disappears on the next render, same as the per-slot
            strike-through prices. Mirror of the web slot page. */}
        {showDiscount && promo ? (
          <View style={styles.promoBanner}>
            <Image
              source={{ uri: `${env.apiUrl}/pickleball-promo-banner.jpg` }}
              style={styles.promoBannerImage}
              resizeMode="cover"
              accessibilityLabel={`Pickleball launch offer — ${promo.percentOff}% off, auto-applied at checkout`}
            />
          </View>
        ) : null}

        {/* Slots — 2-column grid with "5pm - 6pm"-style labels. */}
        <View style={styles.section}>
          <View style={styles.dateHeader}>
            <Clock size={16} color={colors.zinc400} />
            <Text variant="small" color={colors.zinc400}>
              Select Time
            </Text>
          </View>
          {isLoading ? (
            // Slots render as a 2-col grid of pill buttons. Match
            // that shape with skeleton tiles so the picker doesn't
            // jump when availability resolves.
            <View style={slotSkeletonStyles.grid}>
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton
                  key={i}
                  width="48%"
                  height={56}
                  rounded="lg"
                  style={slotSkeletonStyles.tile}
                />
              ))}
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
              promo={promo}
              onUnavailableTap={
                isMedium ? undefined : (h) => setWaitlistHour(h)
              }
              // Past slots aren't waitlist-able. Pass the current IST
              // hour ONLY when today is selected so the grid can render
              // those tiles as plain disabled (no Bell, no notify).
              pastHourCutoff={
                selectedDate === getTodayIST()
                  ? getCurrentHourIST()
                  : undefined
              }
            />
          )}
        </View>

        {/* Selection summary — mirrors web's summary card. When the
            promo is active and the discounted total is smaller, render
            the strike-through original above the discounted amount. */}
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
              {showDiscount && totalDiscounted < totalOriginal ? (
                <View style={styles.summaryPriceRow}>
                  <Text
                    variant="small"
                    color={colors.zinc500}
                    style={styles.summaryStrike}
                  >
                    {formatRupees(totalOriginal)}
                  </Text>
                  <Text
                    variant="heading"
                    color={colors.yellow300}
                    style={styles.summaryAmount}
                  >
                    {formatRupees(totalDiscounted)}
                  </Text>
                </View>
              ) : (
                <Text
                  variant="heading"
                  color={colors.emerald400}
                  style={styles.summaryAmount}
                >
                  {formatRupees(totalOriginal)}
                </Text>
              )}
              <Text variant="tiny" color={colors.zinc500}>
                Total
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* Sticky footer */}
      <View style={styles.footer}>
        {/* Gear picker — auto-expands once the user picks a slot.
            Hidden entirely when no rental equipment is configured for
            this sport, and stays out of the way while the user is
            still picking slots (matches the desktop UX). */}
        {selected.length > 0 && equipmentOptions.length > 0 && (
          <GearPicker
            options={equipmentOptions}
            selectedIds={selectedEquipment}
            onChange={setSelectedEquipment}
            slotCount={selected.length}
          />
        )}
        <View style={styles.footerBody}>
          <Text variant="small" color={colors.mutedForeground}>
            {selected.length === 0
              ? "Pick one or more slots"
              : `${selected.length} × 1 hour · ${sportLabel(params.sport)}`}
          </Text>
          {showDiscount && totalDiscounted < totalOriginal ? (
            <View style={styles.footerPriceRow}>
              <Text
                variant="small"
                color={colors.zinc500}
                style={styles.footerPriceStrike}
              >
                {formatRupees(totalOriginal)}
              </Text>
              <Text variant="heading" color={colors.yellow300}>
                {formatRupees(totalDiscounted)}
              </Text>
            </View>
          ) : (
            <Text variant="heading" color={colors.primary}>
              {total > 0 ? formatRupees(total) : "—"}
            </Text>
          )}
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

      <WaitlistSheet
        visible={waitlistHour !== null}
        onClose={() => setWaitlistHour(null)}
        courtConfigId={params.courtConfigId ?? ""}
        courtLabel={params.courtLabel}
        sport={params.sport}
        date={selectedDate}
        hour={waitlistHour ?? 0}
        signedIn={signedIn}
        onRequireSignIn={() => {
          const rootNav = navigation.getParent<RootNavType<RootStackParamList>>();
          rootNav?.navigate("Phone");
        }}
      />
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
  onUnavailableTap,
  pastHourCutoff,
  promo,
}: {
  slots: SlotAvailability[];
  selected: number[];
  onToggle: (hour: number) => void;
  /** When provided, future-booked tiles become interactive (open waitlist). */
  onUnavailableTap?: (hour: number) => void;
  /**
   * Current IST hour, ONLY when the selected date is today. Slots
   * with `hour <= pastHourCutoff` are treated as past — plain disabled,
   * no Bell, no waitlist option. `undefined` means no slots are past.
   */
  pastHourCutoff?: number;
  /**
   * Active sport promo. When `promo.percentOff` is non-null, each
   * available tile renders strike-through original + amber discounted
   * price. Math via computeAutoApplyDiscount keeps display ≡ charge.
   */
  promo?: ActiveSportPromo | null;
}) {
  const showDiscount = promo?.percentOff != null;
  return (
    <View style={styles.slotsGrid}>
      {slots.map((slot) => {
        const isSelected = selected.includes(slot.hour);
        const isAvailable = slot.status === "available";
        const isPast =
          pastHourCutoff !== undefined && slot.hour <= pastHourCutoff;
        const bookedFutureInteractive =
          !isAvailable && !isPast && Boolean(onUnavailableTap);

        return (
          <Pressable
            key={slot.hour}
            onPress={() => {
              if (isAvailable) onToggle(slot.hour);
              else if (bookedFutureInteractive && onUnavailableTap)
                onUnavailableTap(slot.hour);
            }}
            disabled={!isAvailable && !bookedFutureInteractive}
            style={({ pressed }) => [
              styles.slot,
              isSelected
                ? styles.slotSelected
                : isAvailable
                ? styles.slotAvailable
                : bookedFutureInteractive
                ? styles.slotBookedFuture
                : styles.slotUnavailable,
              pressed &&
                (isAvailable || bookedFutureInteractive) && { opacity: 0.85 },
            ]}
          >
            <View style={styles.slotHeader}>
              <View style={styles.slotTimeRow}>
                <Clock size={12} color={colors.zinc500} />
                {/* `numberOfLines={1}` + `adjustsFontSizeToFit` keep the
                    time on a single line and let RN auto-shrink if a
                    long format like "9:30am - 10am" would otherwise
                    overflow. Mirrors the web slot-grid treatment so
                    tile height stays uniform across sports. */}
                <Text
                  variant="small"
                  weight="500"
                  color={colors.foreground}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={styles.slotTimeText}
                >
                  {formatHourRangeCompact(slot.hour)}
                </Text>
              </View>
              {isSelected ? (
                <Check size={16} color={colors.emerald400} />
              ) : bookedFutureInteractive ? (
                <Bell size={14} color={colors.destructive} />
              ) : null}
            </View>
            {isAvailable && showDiscount && promo ? (
              <View style={styles.slotPriceRow}>
                <Text
                  variant="tiny"
                  color={colors.zinc500}
                  style={styles.slotPriceStrike}
                >
                  {formatRupees(slot.price)}
                </Text>
                <Text
                  variant="tiny"
                  weight="600"
                  color={colors.yellow300}
                  style={styles.slotPriceNew}
                >
                  {formatRupees(slot.price - computeAutoApplyDiscount(slot.price, promo))}
                </Text>
              </View>
            ) : (
              <Text
                variant="tiny"
                color={
                  isAvailable
                    ? colors.zinc400
                    : bookedFutureInteractive
                    ? colors.destructive_300
                    : colors.zinc500
                }
                style={styles.slotFooter}
              >
                {isAvailable
                  ? formatRupees(slot.price)
                  : bookedFutureInteractive
                  ? "Booked · Notify me"
                  : isPast
                  ? "Past"
                  : "Unavailable"}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

// Skeleton-only styles for the 2-col slot grid loading state.
const slotSkeletonStyles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["2"],
  },
  tile: { marginBottom: 0 },
});

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
  // Sticky variant of `section`: same vertical spacing, plus an
  // opaque background and a small border-bottom so the day strip
  // reads as a pinned bar (not a floating section) when it sticks
  // to the top. `gap` is bumped from 12 → 20 so the "Select Date"
  // label has visible breathing room above the date strip — the
  // tighter spacing was making the icon + label cling to the
  // strip's top edge.
  stickyDateSection: {
    marginTop: spacing["4"],
    gap: spacing["5"],
    backgroundColor: colors.background,
    paddingBottom: spacing["3"],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
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
  // Booked-but-still-future slot — reads as "blocked by another
  // booking, but you can join the waitlist". Mirrors web's
  // `bg-red-500/10 border-red-500/40`.
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
  // Time-range text — `flexShrink` lets adjustsFontSizeToFit work
  // by giving the Text a flex container to compute against.
  slotTimeText: {
    flexShrink: 1,
  },
  slotFooter: {
    marginTop: 2,
  },
  slotPriceRow: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  slotPriceStrike: {
    textDecorationLine: "line-through",
  },
  slotPriceNew: {
    // weight-600 + yellow-300 already set inline; layout-only here.
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
  summaryPriceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  summaryStrike: {
    textDecorationLine: "line-through",
  },
  footerPriceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  footerPriceStrike: {
    textDecorationLine: "line-through",
  },
  promoBanner: {
    marginTop: spacing["4"],
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.yellow500_30,
  },
  promoBannerImage: {
    width: "100%",
    aspectRatio: 3, // source is 1200x400 (designer banner)
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

/**
 * Bottom-sheet modal shown when the user taps an unavailable slot.
 * Mirrors the web `<WaitlistDialog>` UX: shows the slot details, plus
 * either a "Notify me" CTA (signed in) or a "Sign in to join" CTA
 * (signed out). On success, switches to a confirmation panel.
 */
function WaitlistSheet({
  visible,
  onClose,
  courtConfigId,
  courtLabel,
  sport,
  date,
  hour,
  signedIn,
  onRequireSignIn,
}: {
  visible: boolean;
  onClose: () => void;
  courtConfigId: string;
  courtLabel: string;
  sport: string;
  date: string;
  hour: number;
  signedIn: boolean;
  onRequireSignIn: () => void;
}) {
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);

  // Reset to fresh state every time the sheet re-opens for a new slot —
  // otherwise the success panel from a previous join would persist.
  const sheetKey = `${courtConfigId}-${date}-${hour}`;
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (visible && lastKey !== sheetKey) {
    setLastKey(sheetKey);
    if (joined) setJoined(false);
    // Funnel-entry event — fires for every fresh slot the sheet
    // opens for. Pairs 1:1 with the waitlist_joined event below
    // so the dashboard can compute tap→join conversion.
    trackSlotUnavailableTap(courtConfigId, hour, date, sport);
  }

  const handleJoin = async () => {
    if (joining) return;
    setJoining(true);
    try {
      const res = await waitlistApi.join({
        courtConfigId,
        date,
        startHour: hour,
        endHour: hour + 1,
      });
      if (res.success) {
        setJoined(true);
        trackWaitlistJoined(courtConfigId, hour, date, sport);
      } else {
        trackWaitlistJoinFailed(courtConfigId, hour, res.error || "unknown");
        Alert.alert("Couldn't join the waitlist", res.error || "Try again.");
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Network error.";
      trackWaitlistJoinFailed(courtConfigId, hour, msg);
      Alert.alert("Couldn't join the waitlist", msg);
    } finally {
      setJoining(false);
    }
  };

  const friendlyDate = formatDateIST(date);
  const dateStr = `${friendlyDate.dayName}, ${friendlyDate.date} ${friendlyDate.month}`;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={sheetStyles.backdrop} onPress={onClose}>
        <Pressable style={sheetStyles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={sheetStyles.handleRow}>
            <View style={sheetStyles.handle} />
          </View>

          <View style={sheetStyles.header}>
            <View style={sheetStyles.headerIcon}>
              <Bell size={20} color={colors.warning} />
            </View>
            <View style={sheetStyles.headerText}>
              <Text variant="heading" weight="700">
                This slot is booked
              </Text>
              <Text variant="small" color={colors.zinc400}>
                Get notified if it opens up
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={sheetStyles.closeBtn}
            >
              <X size={18} color={colors.zinc500} />
            </Pressable>
          </View>

          <View style={sheetStyles.detailsCard}>
            <SheetRow label="Sport" value={sportLabel(sport)} />
            <SheetRow label="Court" value={courtLabel} />
            <SheetRow label="Date" value={dateStr} />
            <SheetRow label="Time" value={formatHourRangeCompact(hour)} />
          </View>

          {joined ? (
            <View style={sheetStyles.successCard}>
              <BellRing size={18} color={colors.emerald400} />
              <View style={{ flex: 1, marginLeft: spacing["2"] }}>
                <Text variant="body" weight="600" color={colors.emerald400}>
                  You're on the waitlist
                </Text>
                <Text
                  variant="small"
                  color={colors.zinc400}
                  style={{ marginTop: 4 }}
                >
                  We'll send a push and SMS the moment this slot opens up.
                  First to book wins.
                </Text>
              </View>
            </View>
          ) : (
            <Text
              variant="small"
              color={colors.zinc400}
              style={sheetStyles.body}
            >
              {signedIn
                ? "We'll alert you on push and SMS the moment this slot is freed by a cancellation. First to book wins."
                : "Sign in once and we'll alert you whenever a slot you're waiting for opens up."}
            </Text>
          )}

          <View style={sheetStyles.actions}>
            {joined ? (
              <Button label="Done" onPress={onClose} fullWidth />
            ) : signedIn ? (
              <Button
                label="Notify me when it opens up"
                onPress={handleJoin}
                loading={joining}
                fullWidth
              />
            ) : (
              <Button
                label="Sign in to join the waitlist"
                onPress={() => {
                  onClose();
                  onRequireSignIn();
                }}
                fullWidth
              />
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={sheetStyles.row}>
      <Text variant="small" color={colors.zinc500} style={sheetStyles.rowLabel}>
        {label}
      </Text>
      <Text variant="small" color={colors.foreground} weight="600">
        {value}
      </Text>
    </View>
  );
}

const sheetStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.cardElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing["6"],
    paddingBottom: spacing["8"],
    paddingTop: spacing["3"],
    gap: spacing["4"],
  },
  handleRow: {
    alignItems: "center",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.zinc700,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
  },
  headerIcon: {
    backgroundColor: colors.warningSoft,
    borderRadius: 999,
    padding: spacing["2.5"],
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  closeBtn: {
    padding: spacing["1"],
  },
  detailsCard: {
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    borderRadius: radius.lg,
    padding: spacing["3"],
    gap: spacing["1.5"],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowLabel: {
    width: 60,
  },
  body: {
    lineHeight: 20,
  },
  successCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_10,
    borderRadius: radius.lg,
    padding: spacing["3"],
  },
  actions: {
    marginTop: spacing["1"],
  },
});
