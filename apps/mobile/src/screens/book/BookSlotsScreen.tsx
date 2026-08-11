import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  Pressable as GesturePressable,
  ScrollView as GestureScrollView,
} from "react-native-gesture-handler";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { NativeStackNavigationProp as RootNavType } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowRightLeft,
  Bell,
  BellRing,
  CalendarDays,
  Check,
  Clock,
  Hourglass,
  Lock,
  X,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  bookingApi,
  type SlotAvailability,
  type BlockingConfig,
  alternativeActionLabel,
  alternativeShortLabel,
  summarizeAvailability,
  summarizeBlockers,
} from "../../lib/booking";
import { GearPicker } from "../../components/booking/GearPicker";
import {
  type ActiveSportPromo,
  computeAutoApplyDiscount,
} from "../../lib/auto-apply-promo";
import { ApiError } from "../../lib/api";
import { waitlistApi } from "../../lib/waitlist";
import {
  trackDateChanged,
  trackLockFailed,
  trackLockSuccess,
  trackProceedToCheckout,
  trackSlotToggled,
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
import { PromoBannerSlot } from "../../components/promo/PromoBannerSlot";
import { PassPitchBanner } from "../../components/booking/PassPitchBanner";
import type {
  BookStackParamList,
  MainTabsParamList,
  RootStackParamList,
} from "../../navigation/types";

type Nav = NativeStackNavigationProp<BookStackParamList, "BookSlots">;
type Rt = RouteProp<BookStackParamList, "BookSlots">;

const DATE_WINDOW_DAYS = 30; // Web shows 30 days of scrollable dates.

// Sky accent for the "someone else is paying for this" tile. Not in
// the theme palette because nothing else uses it; the web grid uses
// Tailwind's sky-400/300 at the same opacities.
const SKY_400 = "#38bdf8";
const SKY_300 = "#7dd3fc";

/** "4:07" / "0:09" — mm:ss, floored, never negative. */
function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function BookSlotsScreen() {
  const { params } = useRoute<Rt>();
  const navigation = useNavigation<Nav>();
  const { state } = useAuth();
  const qc = useQueryClient();

  // Track selectedDate as the IST "YYYY-MM-DD" string directly (web does the
  // same). Easier to compare against getTodayIST() and to pass to the API.
  //
  // When the user pivoted in from another court via the AlternativesSheet,
  // params.prefilledDate carries the date they were looking at on the prior
  // court — keep them on it instead of snapping back to today.
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    params.prefilledDate && /^\d{4}-\d{2}-\d{2}$/.test(params.prefilledDate)
      ? params.prefilledDate
      : getTodayIST(),
  );
  // Tracks which soft-blocked slot's "alternatives" sheet is open;
  // null = closed.
  const [alternativesSlot, setAlternativesSlot] =
    useState<SlotAvailability | null>(null);
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
    trackDateChanged(dateStr);
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

  // "Play more, pay less" pass pitch — the sport's cheapest-hour anchor
  // plans (admin-flagged). Court-specific, so only for direct configId
  // flows; medium mode picks the court later.
  const { data: pitchData } = useQuery({
    queryKey: ["pass-pitch", params.courtConfigId],
    queryFn: () => bookingApi.passPitch(params.courtConfigId!),
    enabled: !!params.courtConfigId,
    staleTime: 5 * 60_000,
  });
  const passPitch = pitchData?.pitch ?? null;
  // Per-slot decoration: uncapped PERCENTAGE slices exactly per slot;
  // FLAT shows each tile at price − value (the price for booking that
  // one slot). Capped percentage stays undecorated. The footer total
  // always uses checkout's real math (flat applies once per booking).
  const showDiscount =
    promo != null && (promo.percentOff != null || promo.type === "FLAT");

  // The signed-in user's live waitlist entries, mapped onto THIS court +
  // date's display hours (slots carry their own lock coords, so the
  // 12am-1am tile — stored on the previous date as hour 24 — matches
  // without date math). Drives the "On the list · tap to leave" tile
  // state: tapping a slot you've already asked to be notified about now
  // REMOVES you from the waitlist instead of re-opening the join popup
  // (Trello 2026-07-12/14: "unable to deselect notify-me slots").
  const { data: mineData } = useQuery({
    queryKey: ["waitlist", "mine"],
    queryFn: () => waitlistApi.mine(),
    enabled: state.status === "signedIn" && !isMedium && !!params.courtConfigId,
    staleTime: 30_000,
  });
  const waitlistedByHour = useMemo(() => {
    const m = new Map<number, string>();
    const entries = mineData?.entries;
    if (!entries?.length || !params.courtConfigId) return m;
    for (const s of slots) {
      const lockDate = s.lockDate ?? selectedDate;
      const lockHour = s.lockHour ?? s.hour;
      const entry = entries.find(
        (e) =>
          e.courtConfigId === params.courtConfigId &&
          (e.status === "WAITING" || e.status === "NOTIFIED") &&
          e.date.slice(0, 10) === lockDate &&
          e.startHour === lockHour,
      );
      if (entry) m.set(s.hour, entry.id);
    }
    return m;
  }, [mineData, slots, params.courtConfigId, selectedDate]);

  const handleLeaveWaitlist = useCallback(
    (hour: number) => {
      const id = waitlistedByHour.get(hour);
      if (!id) return;
      Alert.alert(
        "Leave the waitlist?",
        `You'll stop getting notified if ${formatHourRangeCompact(hour)} frees up on this court.`,
        [
          { text: "Stay on it", style: "cancel" },
          {
            text: "Leave",
            style: "destructive",
            onPress: () => {
              void (async () => {
                try {
                  const res = await waitlistApi.cancel(id);
                  if (!res.success) {
                    Alert.alert(
                      "Couldn't leave the waitlist",
                      res.error ?? "Please try again.",
                    );
                  }
                } catch {
                  Alert.alert(
                    "Couldn't leave the waitlist",
                    "Network error — please try again.",
                  );
                } finally {
                  void qc.invalidateQueries({ queryKey: ["waitlist", "mine"] });
                }
              })();
            },
          },
        ],
      );
    },
    [waitlistedByHour, qc],
  );

  const slotsOriginal = useMemo(
    () =>
      slots
        .filter((s) => selected.includes(s.hour))
        .reduce((sum, s) => sum + s.price, 0),
    [slots, selected]
  );
  const slotsDiscounted = useMemo(() => {
    if (!promo) return slotsOriginal;
    // PERCENTAGE slices per slot (sum of floors = whole-order
    // discount); FLAT applies ONCE to the slot total — tiles stay
    // undecorated for it, but the footer strikes the total, which is
    // exactly what checkout will charge.
    if (promo.percentOff != null) {
      return slots
        .filter((s) => selected.includes(s.hour))
        .reduce(
          (sum, s) => sum + (s.price - computeAutoApplyDiscount(s.price, promo)),
          0,
        );
    }
    return slotsOriginal > 0
      ? Math.max(0, slotsOriginal - computeAutoApplyDiscount(slotsOriginal, promo))
      : slotsOriginal;
  }, [showDiscount, promo, slots, selected, slotsOriginal]);

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
    trackSlotToggled(
      selected.includes(hour) ? "remove" : "add",
      hour,
      slots.find((s) => s.hour === hour)?.price ?? 0,
    );
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

    trackProceedToCheckout(selected.length, total, false);

    // Resolve storage coords for the selected slots. The 12am-1am
    // tile lives on the next calendar date's grid but its storage
    // is the prior date / startHour 24 (server surfaces this as
    // lockDate/lockHour on each slot). Mixed-date selections can't
    // share a Booking row — refuse early.
    const selectedSlotsResolved = slots.filter((s) =>
      selected.includes(s.hour),
    );
    const lockDateSet = new Set(
      selectedSlotsResolved.map((s) => s.lockDate ?? selectedDate),
    );
    if (lockDateSet.size > 1) {
      Alert.alert(
        "Can't book across midnight",
        "You've selected slots that span midnight. Please book the late-night slot separately.",
      );
      return;
    }
    const resolvedLockDate =
      Array.from(lockDateSet)[0] ?? selectedDate;
    const resolvedLockHours = selectedSlotsResolved.map(
      (s) => s.lockHour ?? s.hour,
    );

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
              date: resolvedLockDate,
              hours: resolvedLockHours,
              equipmentSelection,
            }
          : {
              courtConfigId: params.courtConfigId!,
              date: resolvedLockDate,
              hours: resolvedLockHours,
              equipmentSelection,
            }
      );
      if (!res.success || !res.holdId) {
        const msg = res.conflicts?.length
          ? `Hours ${res.conflicts
              .map((h) => formatHourRangeCompact(h))
              .join(", ")} were just booked. Please pick again.`
          : res.error || "Couldn't reserve the slot. Try again.";
        trackLockFailed(msg);
        Alert.alert("Slot unavailable", msg);
        await refetch();
        setSelected([]);
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
    <Screen padded={false} edges={[]}>
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
        {/* Admin-managed promotion banners — the launch banner moved to
            a seeded PromoBanner row (retires with its coupon); the
            per-slot strike-through pricing stays promo-driven below. */}
        <PromoBannerSlot
          screen="SLOT_SELECTION"
          sportSlug={params.sport.toLowerCase()}
          style={styles.promoBanner}
        />

        {/* Cheapest-hour pass pitch — shown while choosing, never at
            checkout (a detour there risks dropping the payment). */}
        {passPitch ? (
          <View style={styles.passPitch}>
            <PassPitchBanner
              pitch={passPitch}
              onPress={() =>
                navigation
                  .getParent<NativeStackNavigationProp<MainTabsParamList>>()
                  ?.navigate("Passes", { screen: "PassesStore" })
              }
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
              // A slot someone else was paying for just came free (or
              // didn't) — pull fresh availability rather than leave a
              // spent countdown on screen.
              onLockExpired={() => void refetch()}
              waitlistedHours={waitlistedByHour}
              onLeaveWaitlist={isMedium ? undefined : handleLeaveWaitlist}
              onUnavailableTap={
                isMedium ? undefined : (h) => setWaitlistHour(h)
              }
              // Soft-block alternatives — same gating as the
              // waitlist (medium mode skips because the merged
              // half-court surface has no meaningful sibling for
              // the user to pivot to).
              onShowAlternatives={
                isMedium ? undefined : (s) => setAlternativesSlot(s)
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
              {totalDiscounted < totalOriginal ? (
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
          {/* Web parity: "1 Slot 12am - 1am" — the slot count + actual
              time range, matching the scrollable summary card above.
              The old "1 × 1 hour · Cricket" duplicated info the user
              already chose and hid the one thing they scroll back to
              check (which hours). */}
          <Text variant="small" color={colors.mutedForeground}>
            {selected.length === 0
              ? "Pick one or more slots"
              : `${selected.length} Slot${selected.length > 1 ? "s" : ""} ${formatHoursAsRanges(selected)}`}
          </Text>
          {totalDiscounted < totalOriginal ? (
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
          // Signing in does not need a slot. Gating this on a selection
          // left a signed-out user staring at a dead "Sign in to
          // continue" button — they had to guess that picking a slot
          // was the way to reach the login screen. handleContinue
          // already routes a signed-out tap straight to Phone.
          disabled={signedIn && selected.length === 0}
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
        onClose={() => {
          setWaitlistHour(null);
          // A join may have just happened inside the sheet — refresh so
          // the tile flips to "On the list" immediately.
          void qc.invalidateQueries({ queryKey: ["waitlist", "mine"] });
        }}
        courtConfigId={params.courtConfigId ?? ""}
        courtLabel={params.courtLabel}
        sport={params.sport}
        date={selectedDate}
        hour={waitlistHour ?? 0}
        lockDate={
          slots.find((s) => s.hour === waitlistHour)?.lockDate ?? selectedDate
        }
        lockHour={
          slots.find((s) => s.hour === waitlistHour)?.lockHour ??
          waitlistHour ??
          0
        }
        signedIn={signedIn}
        onRequireSignIn={() => {
          const rootNav = navigation.getParent<RootNavType<RootStackParamList>>();
          rootNav?.navigate("Phone");
        }}
      />

      <AlternativesSheet
        slot={alternativesSlot}
        onClose={() => setAlternativesSlot(null)}
        onPivot={(alt) => {
          // navigation.replace keeps the back stack flat — pivoting
          // between sibling courts shouldn't pile up screens on
          // back-press. The new route fires its own
          // availability query against the chosen courtConfigId.
          setAlternativesSlot(null);
          navigation.replace("BookSlots", {
            courtConfigId: alt.configId,
            courtLabel: alt.label,
            sport: params.sport,
            prefilledDate: selectedDate,
          });
        }}
        onNotifyMe={
          isMedium
            ? undefined
            : (h) => {
                setAlternativesSlot(null);
                setWaitlistHour(h);
              }
        }
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
    <GestureScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.dateRow}
    >
      {dateStrings.map((dateStr) => {
        const info = formatDateIST(dateStr);
        const isSelected = selectedDate === dateStr;
        return (
          <GesturePressable
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
          </GesturePressable>
        );
      })}
    </GestureScrollView>
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
  onShowAlternatives,
  pastHourCutoff,
  promo,
  waitlistedHours,
  onLeaveWaitlist,
  onLockExpired,
}: {
  slots: SlotAvailability[];
  selected: number[];
  onToggle: (hour: number) => void;
  /** When provided, future-booked tiles become interactive (open waitlist). */
  onUnavailableTap?: (hour: number) => void;
  /**
   * Tap handler for SOFT-blocked tiles — the slot is taken on this
   * court but a sibling court is still free at the same hour. When
   * provided, those tiles render AMBER instead of red and tap opens
   * the alternatives sheet via this callback. Slots with no
   * alternatives fall through to `onUnavailableTap` so the waitlist
   * affordance still works.
   */
  onShowAlternatives?: (slot: SlotAvailability) => void;
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
  /** Display hour → waitlist entry id for slots the user already
   *  joined the waitlist on. Those tiles flip to "On the list" and
   *  tap REMOVES the entry via onLeaveWaitlist. */
  waitlistedHours?: Map<number, string>;
  onLeaveWaitlist?: (hour: number) => void;
  /**
   * Fired once when the soonest checkout hold on the grid lapses, so
   * the parent can refetch. Without it the tile counts down to zero
   * and sits there — the dead end this whole treatment exists to
   * remove, just with a nicer label on it.
   */
  onLockExpired?: () => void;
}) {
  const showDiscount =
    promo != null && (promo.percentOff != null || promo.type === "FLAT");

  // ── Live countdown on slots someone else is paying for ───────────
  // One clock for the grid; each tile derives its own remaining time.
  // No interval at all when nothing is mid-checkout, which is the
  // common case.
  const [now, setNow] = useState(() => Date.now());
  const soonestExpiry = useMemo(() => {
    const times = slots
      .filter((s) => s.status === "locked" && s.lockKind === "checkout" && s.lockedUntil)
      .map((s) => Date.parse(s.lockedUntil!))
      .filter((t) => Number.isFinite(t));
    return times.length > 0 ? Math.min(...times) : null;
  }, [slots]);

  useEffect(() => {
    if (soonestExpiry == null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [soonestExpiry]);

  const refetchedFor = useRef<number | null>(null);
  useEffect(() => {
    if (soonestExpiry == null || !onLockExpired) return;
    if (now < soonestExpiry || refetchedFor.current === soonestExpiry) return;
    refetchedFor.current = soonestExpiry;
    onLockExpired();
  }, [now, soonestExpiry, onLockExpired]);

  return (
    <View style={styles.slotsGrid}>
      {slots.map((slot) => {
        const isSelected = selected.includes(slot.hour);
        const isAvailable = slot.status === "available";
        const isWaitlisted = waitlistedHours?.has(slot.hour) ?? false;
        const isPast =
          pastHourCutoff !== undefined && slot.hour <= pastHourCutoff;

        // Soft block — unavailable on THIS court but the same hour
        // is still bookable on a sibling court (e.g. Full Field is
        // taken but Right Half is free). Renders AMBER and the tap
        // opens the alternatives sheet via the parent. Takes
        // priority over the red notify-me treatment.
        const altCount = slot.blockedReason?.alternativesAtThisHour.length ?? 0;
        const softBlockInteractive =
          !isAvailable &&
          !isPast &&
          altCount > 0 &&
          Boolean(onShowAlternatives);

        const bookedFutureInteractive =
          !isAvailable &&
          !isPast &&
          !softBlockInteractive &&
          Boolean(onUnavailableTap);

        // Amber tile uses positive availability framing ("Half
        // Available"). Red tile keeps the specific blocker tag
        // ("Full court booked · Notify me") so a customer joining
        // the waitlist knows what they're queuing on.
        const availabilityTag = slot.blockedReason
          ? summarizeAvailability(slot.blockedReason.alternativesAtThisHour)
          : null;
        const blockedReasonTag = slot.blockedReason
          ? summarizeBlockers(slot.blockedReason.blockedBy)
          : null;

        // Someone is on the payment screen for this slot right now.
        // The hold dies by itself, so saying when beats saying
        // "Booked" — a customer told the latter walks away from a
        // slot that is usually back within a couple of minutes.
        const isCheckoutLock =
          slot.status === "locked" &&
          slot.lockKind === "checkout" &&
          Boolean(slot.lockedUntil);
        const lockMsLeft = isCheckoutLock
          ? Date.parse(slot.lockedUntil!) - now
          : NaN;
        const payingNow = Number.isFinite(lockMsLeft) && lockMsLeft > 0 && !isPast;
        // Countdown spent, refetch not back yet. Holding the tile here
        // keeps "Booked" from flashing back on at the exact second the
        // customer is watching to see if they got it.
        const lockSettling =
          isCheckoutLock && !payingNow && !isPast && Number.isFinite(lockMsLeft);
        // Paid by static QR / UPI, waiting on an admin to match the
        // UTR by hand. No countdown — that wait has no knowable end.
        const verifying =
          slot.status === "locked" && slot.lockKind === "verification" && !isPast;

        // The pivot still outranks both: booking a free half NOW beats
        // waiting out someone else's checkout.
        const payingTile =
          (payingNow || lockSettling) && !softBlockInteractive && !isWaitlisted;
        const verifyingTile =
          verifying && !softBlockInteractive && !payingTile && !isWaitlisted;

        return (
          <Pressable
            key={slot.hour}
            onPress={() => {
              // A SELECTED tile always deselects first — even when the
              // slot has since gone full (availability refetch, or the
              // user's own hold marking it taken after backing out of
              // checkout). Routing those taps to the notify sheet left
              // the slot stuck in the selection — inflating the total
              // and even reaching checkout with unbookable hours
              // (Trello: "unable to deselect notify-me slots").
              if (isSelected) onToggle(slot.hour);
              else if (isAvailable) onToggle(slot.hour);
              // Already on the waitlist → tap manages (leaves) it
              // instead of re-opening the join popup.
              else if (isWaitlisted && onLeaveWaitlist)
                onLeaveWaitlist(slot.hour);
              else if (softBlockInteractive && onShowAlternatives)
                onShowAlternatives(slot);
              else if (bookedFutureInteractive && onUnavailableTap)
                onUnavailableTap(slot.hour);
            }}
            disabled={
              !isSelected &&
              !isAvailable &&
              !isWaitlisted &&
              !softBlockInteractive &&
              !bookedFutureInteractive
            }
            style={({ pressed }) => [
              styles.slot,
              isSelected
                ? styles.slotSelected
                : isAvailable
                ? styles.slotAvailable
                : isWaitlisted
                ? styles.slotWaitlisted
                : softBlockInteractive
                ? styles.slotSoftBlocked
                : payingTile
                ? styles.slotBeingPaid
                : bookedFutureInteractive
                ? styles.slotBookedFuture
                : styles.slotUnavailable,
              pressed &&
                (isAvailable ||
                  isWaitlisted ||
                  softBlockInteractive ||
                  bookedFutureInteractive) && {
                  opacity: 0.85,
                },
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
              ) : isWaitlisted ? (
                <BellRing size={14} color={colors.emerald400} />
              ) : softBlockInteractive ? (
                <ArrowRightLeft size={14} color={colors.yellow400} />
              ) : payingTile ? (
                <Hourglass size={14} color={SKY_400} />
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
                    : isWaitlisted
                    ? colors.emerald400
                    : softBlockInteractive
                    ? colors.yellow400
                    : payingTile
                    ? SKY_300
                    : bookedFutureInteractive
                    ? colors.destructive_300
                    : colors.zinc500
                }
                style={styles.slotFooter}
              >
                {isAvailable
                  ? formatRupees(slot.price)
                  : isWaitlisted
                  ? "On the list · tap to leave"
                  : softBlockInteractive
                  ? `${availabilityTag ?? "Available"} · tap`
                  : payingTile
                  ? payingNow
                    ? `Being paid for · frees in ${mmss(lockMsLeft)}`
                    : "Checking… · just a moment"
                  : verifyingTile
                  ? bookedFutureInteractive
                    ? "Payment being verified · Notify me"
                    : "Payment being verified"
                  : bookedFutureInteractive
                  ? blockedReasonTag
                    ? `${blockedReasonTag} · Notify me`
                    : "Booked · Notify me"
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
  // to the top. `gap` sits at 24 (was 12 → 20 → 24) so the "Select
  // Date" label has clear breathing room above the date strip —
  // 20 still read as clinging on device (Trello 2026-07-12).
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
    // Extra air under the "Select Date"/"Select Time" labels on top of
    // the section gap — the label still read as clinging to the date
    // strip on device (Trello 2026-07-14).
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
  // User is on the waitlist for this slot — calm emerald "armed bell"
  // state; tap leaves the list (vs red = full, tap to join).
  slotWaitlisted: {
    backgroundColor: colors.emerald500_05,
    borderColor: colors.emerald500_30,
  },
  // Soft block — slot's taken on this court but a sibling court is
  // still free at the same hour. Amber palette signals "pivot
  // available" without the urgency/regret tone of the red waitlist
  // tile. Tap opens AlternativesSheet.
  slotSoftBlocked: {
    backgroundColor: "rgba(245, 158, 11, 0.10)",
    borderColor: "rgba(245, 158, 11, 0.40)",
  },
  // Sky, not amber: amber already means "there's another court you can
  // pivot to" on this same grid, and two ambers meaning different
  // things is how a colour code stops being read at all.
  slotBeingPaid: {
    backgroundColor: "rgba(14, 165, 233, 0.10)",
    borderColor: "rgba(14, 165, 233, 0.40)",
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
  passPitch: {
    // No horizontal margin: the ScrollView already pads by spacing[6], and
    // adding more here made the pass banner narrower than the promo banner
    // directly above it. marginTop separates the two — they were flush.
    marginTop: spacing["4"],
    marginBottom: spacing["2"],
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
  lockDate,
  lockHour,
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
  // Storage coords for the join API (the 12am–1am tile stores on the prior
  // date / hour 24); date/hour stay display-only (label + analytics).
  lockDate?: string;
  lockHour?: number;
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
      // Storage coords so the row matches what the freed-slot notifier
      // queries (the 12am–1am tile stores on the prior date / hour 24).
      const wlDate = lockDate ?? date;
      const wlHour = lockHour ?? hour;
      const res = await waitlistApi.join({
        courtConfigId,
        date: wlDate,
        startHour: wlHour,
        endHour: wlHour + 1,
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

// ---------------------------------------------------------------------------
// AlternativesSheet — RN port of components/booking/alternatives-sheet.tsx
//
// Opens when the user taps an amber soft-blocked tile. Shows what's
// specifically taken on the current court and which sibling courts
// are still free at that hour. Tap a sibling → navigation.replace
// to its slot screen with the same date preserved. Falls back to a
// "Notify me anyway" CTA for the original court.
// ---------------------------------------------------------------------------
function AlternativesSheet({
  slot,
  onClose,
  onPivot,
  onNotifyMe,
}: {
  slot: SlotAvailability | null;
  onClose: () => void;
  onPivot: (alt: BlockingConfig) => void;
  onNotifyMe?: (hour: number) => void;
}) {
  const visible = slot !== null;
  const alternatives = slot?.blockedReason?.alternativesAtThisHour ?? [];
  // Header matches the tile's positive framing ("Half Available")
  // so the sheet reads as a continuation of the tap, not a new
  // context. Per-row labels below still spell out the specific
  // sibling courts.
  const headline = summarizeAvailability(alternatives);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={sheetStyles.backdrop} onPress={onClose}>
        <Pressable
          style={sheetStyles.sheet}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={sheetStyles.handleRow}>
            <View style={sheetStyles.handle} />
          </View>

          <View style={sheetStyles.header}>
            <View style={sheetStyles.headerIcon}>
              <ArrowRightLeft size={18} color={colors.warning} />
            </View>
            <View style={sheetStyles.headerText}>
              <Text variant="tiny" color={colors.zinc500} weight="600">
                {slot ? formatHourRangeCompact(slot.hour).toUpperCase() : ""}
              </Text>
              <Text variant="heading" weight="700">
                {headline}
              </Text>
            </View>
            <Pressable onPress={onClose} style={sheetStyles.closeBtn}>
              <X size={18} color={colors.zinc500} />
            </Pressable>
          </View>

          {alternatives.length > 0 ? (
            <View style={altSheetStyles.list}>
              <Text variant="small" color={colors.zinc400}>
                Still bookable at this hour:
              </Text>
              {alternatives.map((alt) => (
                <Pressable
                  key={alt.configId}
                  onPress={() => onPivot(alt)}
                  style={({ pressed }) => [
                    altSheetStyles.altRow,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    {/* Action-oriented + generic by SIZE — drops the
                        DB-side "Medium (Right Half)" wording. Venue
                        assigns the physical side at game time. */}
                    <Text
                      variant="body"
                      weight="600"
                      color={colors.emerald400}
                    >
                      {alternativeActionLabel(alt)}
                    </Text>
                    <Text variant="tiny" color={colors.emerald400}>
                      {alternativeShortLabel(alt)}
                    </Text>
                  </View>
                  <ArrowRight size={16} color={colors.emerald400} />
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={altSheetStyles.noneCard}>
              <Text variant="small" color={colors.zinc400}>
                No alternative courts are free at this hour.
              </Text>
            </View>
          )}

          {onNotifyMe && slot ? (
            <Pressable
              onPress={() => onNotifyMe(slot.hour)}
              style={({ pressed }) => [
                altSheetStyles.notifyBtn,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Bell size={14} color={colors.destructive_300} />
              <Text
                variant="small"
                weight="600"
                color={colors.destructive_300}
              >
                Notify me when full court becomes available
              </Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const altSheetStyles = StyleSheet.create({
  list: {
    gap: spacing["2"],
  },
  altRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_10,
    borderRadius: radius.lg,
    paddingVertical: spacing["3"],
    paddingHorizontal: spacing["3"],
    gap: spacing["2"],
  },
  noneCard: {
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: colors.zinc900,
    borderRadius: radius.lg,
    padding: spacing["3"],
  },
  notifyBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["1.5"],
    borderWidth: 1,
    borderColor: colors.destructive_30,
    backgroundColor: colors.destructive_10,
    borderRadius: radius.lg,
    paddingVertical: spacing["2.5"],
  },
});
