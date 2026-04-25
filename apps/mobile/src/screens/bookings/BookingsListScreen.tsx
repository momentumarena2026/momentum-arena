import { useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useInfiniteQuery } from "@tanstack/react-query";
import LinearGradient from "react-native-linear-gradient";
import {
  Calendar,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  Clock,
  IndianRupee,
  Trophy,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { BookingCard } from "../../components/BookingCard";
import { colors, spacing } from "../../theme";
import { bookingsApi } from "../../lib/bookings";
import type {
  Booking,
  BookingsListResponse,
  BookingsListSummary,
} from "../../lib/types";
import type {
  AccountStackParamList,
  MainTabsParamList,
} from "../../navigation/types";

type Nav = NativeStackNavigationProp<AccountStackParamList, "BookingsList">;

const PAGE_SIZE = 20;

/** Distance from the bottom (in px) at which we start prefetching the next page. */
const END_REACHED_THRESHOLD = 240;

/**
 * My Bookings list — mirrors web's `app/(protected)/bookings/page.tsx`.
 *
 * Uses `useInfiniteQuery` + a ScrollView `onScroll` handler to lazy-load
 * older bookings as the user nears the bottom. The hero card stats come
 * from the page-1 `summary` block so they don't mutate as more pages
 * append.
 */
export function BookingsListScreen() {
  const navigation = useNavigation<Nav>();

  const {
    data,
    isLoading,
    isError,
    refetch,
    isRefetching,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<BookingsListResponse>({
    queryKey: ["bookings", "infinite"],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      bookingsApi.list({ page: pageParam as number, limit: PAGE_SIZE }),
    getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
  });

  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const goToBook = useCallback(() => {
    navigation
      .getParent<BottomTabNavigationProp<MainTabsParamList>>()
      ?.navigate("Sports", { screen: "BookSport" });
  }, [navigation]);

  const goToDetail = useCallback(
    (bookingId: string) => {
      navigation.navigate("BookingDetail", { bookingId });
    },
    [navigation],
  );

  // Flatten all pages, split into upcoming / past by IST calendar day.
  // `summary` (from page 1) owns the hero totals so the tiles don't
  // mutate as pages load.
  const { allBookings, summary, upcoming, past } = useMemo(() => {
    const pages = data?.pages ?? [];
    const flat: Booking[] = pages.flatMap((p) => p.bookings);
    const summaryBlock: BookingsListSummary | undefined = pages[0]?.summary;

    const todayIST = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata",
    });
    const key = (iso: string) => iso.split("T")[0];

    const up: Booking[] = [];
    const pa: Booking[] = [];
    for (const b of flat) {
      const isActive = b.status === "CONFIRMED" || b.status === "PENDING";
      if (isActive && key(b.date) >= todayIST) up.push(b);
      else pa.push(b);
    }

    return {
      allBookings: flat,
      summary: summaryBlock,
      upcoming: up,
      past: pa,
    };
  }, [data]);

  const total = summary?.total ?? allBookings.length;

  // Fires `fetchNextPage` as the user nears the bottom of the scroll
  // view. ScrollView doesn't have native `onEndReached`, so we compute
  // it from the scroll event + a fixed pixel threshold.
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!hasNextPage || isFetchingNextPage) return;
      const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
      const distanceFromBottom =
        contentSize.height - (contentOffset.y + layoutMeasurement.height);
      if (distanceFromBottom < END_REACHED_THRESHOLD) {
        void fetchNextPage();
      }
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        onScroll={onScroll}
        // Fire onScroll frequently enough to catch fast flings without
        // flooding JS; 64ms ≈ 15 Hz which is plenty for a threshold check.
        scrollEventThrottle={64}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching && !isFetchingNextPage}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* ─── Hero Header ─────────────────────────────────────────────── */}
        <HeroHeader
          total={total}
          upcoming={summary?.upcoming ?? upcoming.length}
          confirmedCount={summary?.confirmed ?? 0}
          totalSpent={summary?.totalSpent ?? 0}
          hasBookings={total > 0}
          onBook={goToBook}
        />

        {/* ─── Body ────────────────────────────────────────────────────── */}
        {isLoading ? (
          <View style={styles.loader}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : isError ? (
          <View style={styles.errorCard}>
            <Text variant="body" color={colors.mutedForeground}>
              Couldn't load your bookings. Pull to retry.
            </Text>
          </View>
        ) : allBookings.length === 0 ? (
          <EmptyState onBook={goToBook} />
        ) : (
          <View style={styles.sections}>
            {upcoming.length > 0 && (
              <View>
                <SectionHeader
                  icon={<CalendarDays size={12} color={colors.emerald400} />}
                  title="Upcoming"
                  count={upcoming.length}
                />
                <View style={styles.list}>
                  {upcoming.map((b) => (
                    <BookingCard
                      key={b.id}
                      booking={b}
                      onPress={() => goToDetail(b.id)}
                    />
                  ))}
                </View>
              </View>
            )}

            {past.length > 0 && (
              <View>
                <SectionHeader
                  icon={<Clock size={12} color={colors.zinc500} />}
                  title="Previous"
                  count={past.length}
                />
                <View style={styles.list}>
                  {past.map((b) => (
                    <BookingCard
                      key={b.id}
                      booking={b}
                      past
                      onPress={() => goToDetail(b.id)}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* Footer: either a spinner while prefetching the next
                page, or a subtle "caught up" hint when there's
                nothing left to load. */}
            {isFetchingNextPage ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : !hasNextPage && allBookings.length > PAGE_SIZE ? (
              <View style={styles.footerCaughtUp}>
                <Text style={styles.footerCaughtUpText}>
                  You're all caught up.
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────────

interface HeroHeaderProps {
  total: number;
  upcoming: number;
  confirmedCount: number;
  totalSpent: number;
  hasBookings: boolean;
  onBook: () => void;
}

function HeroHeader({
  total,
  upcoming,
  confirmedCount,
  totalSpent,
  hasBookings,
  onBook,
}: HeroHeaderProps) {
  return (
    <View style={heroStyles.container}>
      <LinearGradient
        colors={["#18181b", "#18181b", "#09090b"]}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={heroStyles.gradient}
      />
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

        <Text style={heroStyles.heading}>My Bookings</Text>

        <Text style={heroStyles.subheading}>
          {total} total · {upcoming} upcoming
        </Text>

        {hasBookings && (
          <View style={heroStyles.statsGrid}>
            <StatCard
              icon={<CheckCircle2 size={12} color={colors.emerald400} />}
              label="Confirmed"
              value={String(confirmedCount)}
            />
            <StatCard
              icon={<CalendarDays size={12} color="#38bdf8" />}
              label="Upcoming"
              value={String(upcoming)}
            />
            <StatCard
              icon={<IndianRupee size={12} color="#fbbf24" />}
              label="Spent"
              value={formatRupeesCompact(totalSpent)}
            />
          </View>
        )}

        <Pressable
          onPress={onBook}
          style={({ pressed }) => [
            heroStyles.cta,
            pressed && heroStyles.ctaPressed,
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
      </View>
    </View>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function StatCard({ icon, label, value }: StatCardProps) {
  return (
    <View style={statStyles.card}>
      <View style={statStyles.row}>
        {icon}
        <Text
          style={statStyles.label}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.85}
          allowFontScaling={false}
        >
          {label}
        </Text>
      </View>
      <Text
        style={statStyles.value}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {value}
      </Text>
    </View>
  );
}

function formatRupeesCompact(amount: number): string {
  if (amount < 1000) return `₹${amount}`;
  if (amount < 100000) {
    const k = amount / 1000;
    const rounded = k >= 100 ? Math.round(k) : Math.round(k * 10) / 10;
    return `₹${String(rounded).replace(/\.0$/, "")}K`;
  }
  const l = amount / 100000;
  const rounded = Math.round(l * 10) / 10;
  return `₹${String(rounded).replace(/\.0$/, "")}L`;
}

interface SectionHeaderProps {
  icon: React.ReactNode;
  title: string;
  count?: number;
}

function SectionHeader({ icon, title, count }: SectionHeaderProps) {
  return (
    <View style={sectionStyles.row}>
      <View style={sectionStyles.iconTile}>{icon}</View>
      <Text style={sectionStyles.title}>{title}</Text>
      {count !== undefined && (
        <View style={sectionStyles.countPill}>
          <Text style={sectionStyles.countText}>{count}</Text>
        </View>
      )}
      <LinearGradient
        colors={[colors.zinc800, "rgba(39, 39, 42, 0)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={sectionStyles.hairline}
      />
    </View>
  );
}

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
        <Calendar size={36} color={colors.zinc600} />
      </View>
      <Text style={emptyStyles.title}>No bookings yet</Text>
      <Text style={emptyStyles.subtitle}>
        Your first game is just a couple of taps away.
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
// Styles
// ────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: spacing["6"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["10"],
    gap: spacing["6"],
  },
  loader: {
    paddingVertical: spacing["10"],
    alignItems: "center",
  },
  errorCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["4"],
  },
  sections: {
    gap: spacing["6"],
  },
  list: {
    gap: spacing["3"],
  },
  footerLoader: {
    paddingVertical: spacing["4"],
    alignItems: "center",
  },
  footerCaughtUp: {
    paddingVertical: spacing["4"],
    alignItems: "center",
  },
  footerCaughtUpText: {
    fontSize: 12,
    color: colors.zinc500,
  },
});

const heroStyles = StyleSheet.create({
  container: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.zinc800,
  },
  gradient: { ...StyleSheet.absoluteFillObject },
  blob: { position: "absolute", borderRadius: 9999, opacity: 0.9 },
  content: { padding: spacing["6"] },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  eyebrowText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 2,
    color: "rgba(110, 231, 183, 0.90)",
    textTransform: "uppercase",
  },
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
  statsGrid: {
    marginTop: spacing["6"],
    flexDirection: "row",
    gap: 10,
  },
  cta: {
    marginTop: spacing["6"],
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#059669",
    paddingHorizontal: spacing["4"],
    paddingVertical: spacing["2"],
    borderRadius: 12,
  },
  ctaPressed: { backgroundColor: "#10b981" },
  ctaText: { fontSize: 14 },
});

const statStyles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: "rgba(0, 0, 0, 0.40)",
    paddingVertical: 10,
    paddingHorizontal: 10,
    minHeight: 58,
    justifyContent: "center",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  label: {
    flexShrink: 1,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 0.4,
    color: colors.zinc500,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  value: {
    marginTop: 4,
    fontSize: 17,
    lineHeight: 20,
    fontWeight: "700",
    color: colors.foreground,
  },
});

const sectionStyles = StyleSheet.create({
  row: {
    marginBottom: spacing["3"],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  iconTile: {
    backgroundColor: "rgba(39, 39, 42, 0.80)",
    padding: 4,
    borderRadius: 6,
  },
  title: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1.8,
    color: colors.zinc400,
    textTransform: "uppercase",
  },
  countPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
  },
  countText: { fontSize: 10, fontWeight: "500", color: colors.zinc400 },
  hairline: { marginLeft: spacing["2"], flex: 1, height: 1 },
});

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
  gradient: { ...StyleSheet.absoluteFillObject },
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
