import { useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useQuery } from "@tanstack/react-query";
import LinearGradient from "react-native-linear-gradient";
import {
  ArrowUpRight,
  Calendar,
  CalendarPlus,
  ChevronRight,
  Clock,
  RefreshCw,
  Sparkles,
  Trophy,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { colors, spacing } from "../../theme";
import { bookingsApi } from "../../lib/bookings";
import {
  formatDate,
  formatHourCompact,
  sportEmoji,
  sportLabel,
} from "../../lib/format";
import type {
  RecurringListResponse,
  RecurringSeries,
  Sport,
} from "../../lib/types";
import type {
  AccountStackParamList,
  MainTabsParamList,
} from "../../navigation/types";

type Nav = NativeStackNavigationProp<AccountStackParamList, "RecurringBookings">;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Per-sport palette — mirrors `SPORT_THEME` in the web RecurringCard
// (app/(protected)/bookings/page.tsx).
const SPORT_THEME: Record<
  Sport,
  { tileBg: string; tileBorder: string }
> = {
  CRICKET: {
    tileBg: "rgba(16, 185, 129, 0.10)",
    tileBorder: "rgba(16, 185, 129, 0.30)",
  },
  FOOTBALL: {
    tileBg: "rgba(14, 165, 233, 0.10)",
    tileBorder: "rgba(14, 165, 233, 0.30)",
  },
  PICKLEBALL: {
    tileBg: "rgba(245, 158, 11, 0.10)",
    tileBorder: "rgba(245, 158, 11, 0.30)",
  },
};

/**
 * Recurring Bookings — mirrors the web's `/bookings?filter=recurring`
 * route (app/(protected)/bookings/page.tsx) rendered with `showOnlyRecurring`.
 *
 * Fetches the caller's active/paused recurring series from
 * `/api/mobile/recurring` and renders one RecurringCard per row, with
 * a "Next up" chip strip linking to the next 3 confirmed instances.
 *
 * Falls back to the same empty state the web shows when the user has
 * no series yet.
 */
export function RecurringBookingsScreen() {
  const navigation = useNavigation<Nav>();

  const {
    data,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useQuery<RecurringListResponse>({
    queryKey: ["recurring", "list"],
    queryFn: () => bookingsApi.recurring(),
  });

  const recurring = useMemo<RecurringSeries[]>(
    () => data?.recurring ?? [],
    [data],
  );

  const goToBook = useCallback(() => {
    navigation
      .getParent<BottomTabNavigationProp<MainTabsParamList>>()
      ?.navigate("Book", { screen: "BookSport" });
  }, [navigation]);

  const goToAllBookings = useCallback(
    () => navigation.navigate("BookingsList"),
    [navigation],
  );

  const goToBookingDetail = useCallback(
    (bookingId: string) => {
      navigation.navigate("BookingDetail", { bookingId });
    },
    [navigation],
  );

  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const recurringCount = recurring.length;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching && !isLoading}
            onRefresh={onRefresh}
            tintColor={colors.zinc400}
            colors={[colors.primary]}
          />
        }
      >
        {/* ─── Hero Header ─────────────────────────────────────────────── */}
        <View style={heroStyles.container}>
          <LinearGradient
            colors={["#18181b", "#18181b", "#09090b"]}
            locations={[0, 0.5, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={heroStyles.gradient}
          />
          {/* Decorative emerald blob (approximation of web's blur-3xl) */}
          <View
            pointerEvents="none"
            style={[
              heroStyles.blob,
              {
                top: -96,
                right: -96,
                width: 256,
                height: 256,
                backgroundColor: "rgba(16, 185, 129, 0.18)",
              },
            ]}
          />
          {/* Decorative sky blob */}
          <View
            pointerEvents="none"
            style={[
              heroStyles.blob,
              {
                bottom: -112,
                left: -112,
                width: 288,
                height: 288,
                backgroundColor: "rgba(14, 165, 233, 0.10)",
              },
            ]}
          />

          <View style={heroStyles.content}>
            <View style={heroStyles.eyebrow}>
              <Trophy size={14} color={colors.emerald400} />
              <Text style={heroStyles.eyebrowText}>Your Playtime</Text>
            </View>

            <Text style={heroStyles.heading}>Recurring Series</Text>
            <Text style={heroStyles.subheading}>
              {recurringCount} active {recurringCount === 1 ? "series" : "series"}
            </Text>

            <View style={heroStyles.ctaRow}>
              <Pressable
                onPress={goToBook}
                style={({ pressed }) => [
                  heroStyles.ctaPrimary,
                  pressed && heroStyles.ctaPrimaryPressed,
                ]}
              >
                <CalendarPlus size={16} color={colors.foreground} />
                <Text
                  color={colors.foreground}
                  weight="600"
                  style={heroStyles.ctaText}
                >
                  Book a Court
                </Text>
              </Pressable>

              <Pressable
                onPress={goToAllBookings}
                style={({ pressed }) => [
                  heroStyles.ctaSecondary,
                  pressed && heroStyles.ctaSecondaryPressed,
                ]}
              >
                <Text style={heroStyles.ctaSecondaryText}>Show All</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* ─── Loading / Error / List / Empty ──────────────────────────── */}
        {isLoading && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}

        {!isLoading && isError && (
          <ErrorState onRetry={() => void refetch()} />
        )}

        {!isLoading && !isError && recurring.length > 0 && (
          <View style={styles.list}>
            {recurring.map((series) => (
              <RecurringCard
                key={series.id}
                series={series}
                onOpenBooking={goToBookingDetail}
              />
            ))}
          </View>
        )}

        {!isLoading && !isError && recurring.length === 0 && (
          <EmptyState onBook={goToBook} />
        )}
      </ScrollView>
    </Screen>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// RecurringCard — mirrors web's RecurringCard in app/(protected)/bookings/page.tsx
// ────────────────────────────────────────────────────────────────────────────

interface RecurringCardProps {
  series: RecurringSeries;
  onOpenBooking: (bookingId: string) => void;
}

function RecurringCard({ series, onOpenBooking }: RecurringCardProps) {
  const theme = SPORT_THEME[series.courtConfig.sport];
  const isActive = series.status === "ACTIVE";
  const dayLabel = DAY_NAMES[series.dayOfWeek] ?? "?";

  return (
    <View style={cardStyles.wrap}>
      {/* Decorative sky blob — approximation of web's blur-3xl */}
      <View
        pointerEvents="none"
        style={[
          cardStyles.blob,
          {
            top: -64,
            right: -64,
            width: 160,
            height: 160,
            backgroundColor: "rgba(14, 165, 233, 0.12)",
          },
        ]}
      />

      <View style={cardStyles.headerRow}>
        <View style={cardStyles.headerLeft}>
          {/* Sport-themed emoji tile */}
          <View
            style={[
              cardStyles.iconTile,
              { backgroundColor: theme.tileBg, borderColor: theme.tileBorder },
            ]}
          >
            <Text style={cardStyles.iconEmoji}>
              {sportEmoji(series.courtConfig.sport)}
            </Text>
          </View>

          <View style={cardStyles.headerText}>
            <View style={cardStyles.titleRow}>
              <Text style={cardStyles.sportName} numberOfLines={1}>
                {sportLabel(series.courtConfig.sport)}
              </Text>
              <Text style={cardStyles.courtLabel} numberOfLines={1}>
                {series.courtConfig.label}
              </Text>
            </View>

            <View style={cardStyles.pillRow}>
              <View style={cardStyles.pillSky}>
                <Calendar size={12} color="#7dd3fc" />
                <Text style={cardStyles.pillSkyText}>Every {dayLabel}</Text>
              </View>
              <View style={cardStyles.pillNeutral}>
                <Clock size={12} color={colors.zinc500} />
                <Text style={cardStyles.pillNeutralText}>
                  {formatHourCompact(series.startHour)} –{" "}
                  {formatHourCompact(series.endHour)}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Status pill */}
        <View
          style={[
            cardStyles.statusPill,
            isActive ? cardStyles.statusPillActive : cardStyles.statusPillPaused,
          ]}
        >
          {isActive && <Sparkles size={10} color="#6ee7b7" />}
          <Text
            style={[
              cardStyles.statusPillText,
              { color: isActive ? "#6ee7b7" : "#fde68a" },
            ]}
          >
            {series.status}
          </Text>
        </View>
      </View>

      {/* Next up chips */}
      {series.bookings.length > 0 && (
        <View style={cardStyles.nextUpWrap}>
          <Text style={cardStyles.nextUpLabel}>Next up</Text>
          <View style={cardStyles.chipRow}>
            {series.bookings.map((b) => (
              <Pressable
                key={b.id}
                onPress={() => onOpenBooking(b.id)}
                style={({ pressed }) => [
                  cardStyles.chip,
                  pressed && cardStyles.chipPressed,
                ]}
              >
                <Text style={cardStyles.chipText}>{formatDate(b.date)}</Text>
                <ArrowUpRight size={12} color={colors.zinc400} />
              </Pressable>
            ))}
            {/* Hint that more is reachable through the chip */}
            <ChevronRight size={14} color={colors.zinc700} />
          </View>
        </View>
      )}
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Empty state — mirrors web's EmptyState for recurring filter
// ────────────────────────────────────────────────────────────────────────────

interface EmptyStateProps {
  onBook: () => void;
}

function EmptyState({ onBook }: EmptyStateProps) {
  return (
    <View style={emptyStyles.wrap}>
      <LinearGradient
        colors={["#18181b", "#09090b"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={emptyStyles.gradient}
      />
      <View style={emptyStyles.iconTile}>
        <RefreshCw size={36} color={colors.zinc600} />
      </View>
      <Text style={emptyStyles.title}>No recurring series yet</Text>
      <Text style={emptyStyles.subtitle}>
        Create a recurring booking when selecting your slots.
      </Text>
      <Pressable
        onPress={onBook}
        style={({ pressed }) => [
          emptyStyles.cta,
          pressed && { opacity: 0.85 },
        ]}
      >
        <CalendarPlus size={16} color={colors.foreground} />
        <Text color={colors.foreground} weight="600" style={{ fontSize: 14 }}>
          Book a Court
        </Text>
      </Pressable>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Error state — shown when the recurring API request fails
// ────────────────────────────────────────────────────────────────────────────

interface ErrorStateProps {
  onRetry: () => void;
}

function ErrorState({ onRetry }: ErrorStateProps) {
  return (
    <View style={errorStyles.wrap}>
      <Text style={errorStyles.title}>Couldn&apos;t load recurring series</Text>
      <Text style={errorStyles.subtitle}>
        Pull to refresh, or try again.
      </Text>
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => [
          errorStyles.cta,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text color={colors.foreground} weight="600" style={{ fontSize: 14 }}>
          Retry
        </Text>
      </Pressable>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: spacing["6"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["10"],
    gap: spacing["6"],
  },
  center: {
    paddingVertical: spacing["12"],
    alignItems: "center",
  },
  list: {
    gap: spacing["3"],
  },
});

// Hero (web: rounded-3xl border + gradient + blobs)
const heroStyles = StyleSheet.create({
  container: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.zinc800,
  },
  // Inlined absolute-fill (RN type for StyleSheet.absoluteFillObject is
  // out of sync in this RN version, so we spell it out).
  gradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  blob: {
    position: "absolute",
    borderRadius: 9999,
    opacity: 0.9,
  },
  content: {
    padding: spacing["6"],
  },
  eyebrow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  // Web: text-[11px] font-semibold uppercase tracking-[0.2em]
  //      text-emerald-300/90
  eyebrowText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 2,
    color: "rgba(110, 231, 183, 0.90)",
    textTransform: "uppercase",
  },
  // Web: mt-2 text-3xl font-bold text-white
  heading: {
    marginTop: spacing["2"],
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "700",
    color: colors.foreground,
    letterSpacing: -0.5,
  },
  subheading: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: colors.zinc400,
  },
  // Web: mt-6 flex flex-wrap gap-2
  ctaRow: {
    marginTop: spacing["6"],
    flexDirection: "row",
    gap: spacing["2"],
    flexWrap: "wrap",
  },
  // Web: rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold
  ctaPrimary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#059669", // emerald-600
    paddingHorizontal: spacing["4"],
    paddingVertical: spacing["2"],
    borderRadius: 12,
  },
  ctaPrimaryPressed: {
    backgroundColor: "#10b981",
  },
  ctaText: {
    fontSize: 14,
  },
  // Web: rounded-xl border border-zinc-700 bg-zinc-800/60 px-4 py-2
  //      text-sm font-medium text-zinc-200
  ctaSecondary: {
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: "rgba(39, 39, 42, 0.60)",
    paddingHorizontal: spacing["4"],
    paddingVertical: spacing["2"],
    borderRadius: 12,
  },
  ctaSecondaryPressed: {
    backgroundColor: colors.zinc800,
  },
  ctaSecondaryText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#e4e4e7", // zinc-200
  },
});

// RecurringCard (web: rounded-2xl border-zinc-800 bg-gradient + sky blob)
const cardStyles = StyleSheet.create({
  wrap: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["5"],
  },
  blob: {
    position: "absolute",
    borderRadius: 9999,
    opacity: 0.9,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing["4"],
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing["3"],
    flex: 1,
    minWidth: 0,
  },
  iconTile: {
    width: 56,
    height: 56,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  iconEmoji: {
    fontSize: 24,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    flexWrap: "wrap",
  },
  sportName: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.foreground,
  },
  courtLabel: {
    fontSize: 12,
    color: colors.zinc500,
  },
  pillRow: {
    marginTop: spacing["2"],
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["2"],
  },
  // Web: border-sky-500/20 bg-sky-500/10 text-sky-300
  pillSky: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(14, 165, 233, 0.20)",
    backgroundColor: "rgba(14, 165, 233, 0.10)",
  },
  pillSkyText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#7dd3fc",
  },
  // Web: bg-zinc-800/70 text-zinc-300
  pillNeutral: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(39, 39, 42, 0.70)",
  },
  pillNeutralText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#d4d4d8",
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 9999,
    borderWidth: 1,
  },
  statusPillActive: {
    borderColor: "rgba(16, 185, 129, 0.30)",
    backgroundColor: "rgba(16, 185, 129, 0.10)",
  },
  statusPillPaused: {
    borderColor: "rgba(245, 158, 11, 0.30)",
    backgroundColor: "rgba(245, 158, 11, 0.10)",
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  nextUpWrap: {
    marginTop: spacing["4"],
    paddingTop: spacing["4"],
    borderTopWidth: 1,
    borderTopColor: colors.zinc800,
  },
  nextUpLabel: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: colors.zinc500,
    marginBottom: spacing["2"],
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing["2"],
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: "rgba(39, 39, 42, 0.60)",
  },
  chipPressed: {
    backgroundColor: colors.zinc800,
  },
  chipText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#d4d4d8",
  },
});

// Empty state (web: rounded-2xl border-zinc-800 bg-gradient-to-br
//              from-zinc-900 to-zinc-950 p-12 text-center)
const emptyStyles = StyleSheet.create({
  wrap: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.zinc800,
    padding: 48,
    alignItems: "center",
  },
  // Inlined absolute-fill (RN type for StyleSheet.absoluteFillObject is
  // out of sync in this RN version, so we spell it out).
  gradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  // Web: mx-auto inline-flex rounded-2xl bg-zinc-800/60 p-3
  iconTile: {
    backgroundColor: "rgba(39, 39, 42, 0.60)",
    padding: spacing["3"],
    borderRadius: 16,
  },
  title: {
    marginTop: spacing["4"],
    fontSize: 16,
    fontWeight: "600",
    color: colors.foreground,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: colors.zinc500,
    textAlign: "center",
  },
  cta: {
    marginTop: spacing["5"],
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#059669",
    paddingHorizontal: spacing["4"],
    paddingVertical: spacing["2"],
    borderRadius: 12,
  },
});

const errorStyles = StyleSheet.create({
  wrap: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.30)",
    backgroundColor: "rgba(239, 68, 68, 0.05)",
    padding: spacing["6"],
    alignItems: "center",
    gap: spacing["2"],
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fca5a5",
  },
  subtitle: {
    fontSize: 12,
    color: colors.zinc500,
    textAlign: "center",
  },
  cta: {
    marginTop: spacing["2"],
    paddingHorizontal: spacing["4"],
    paddingVertical: spacing["2"],
    borderRadius: 12,
    backgroundColor: "#7f1d1d",
  },
});
