import { useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarRange,
  ChevronRight,
  Filter,
  Search as SearchIcon,
  User as UserIcon,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminBookingsApi,
  type AdminBookingListItem,
  type ListFilters,
} from "../../lib/admin-bookings";
import {
  formatDateLong,
  formatHoursAsRanges,
  formatRupees,
  sportLabel,
} from "../../lib/format";
import type { AdminBookingsStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<
  AdminBookingsStackParamList,
  "AdminBookingsList"
>;

const STATUS_OPTIONS: Array<{
  label: string;
  value: ListFilters["status"];
  dot?: string;
}> = [
  { label: "All", value: "ALL" },
  { label: "Confirmed", value: "CONFIRMED", dot: colors.emerald400 },
  { label: "Pending", value: "PENDING", dot: colors.yellow400 },
  { label: "Cancelled", value: "CANCELLED", dot: colors.destructive },
];

const SPORT_OPTIONS: Array<{
  label: string;
  value: ListFilters["sport"] | undefined;
  emoji: string;
}> = [
  { label: "All", value: undefined, emoji: "" },
  { label: "Cricket", value: "CRICKET", emoji: "🏏" },
  { label: "Football", value: "FOOTBALL", emoji: "⚽" },
  { label: "Pickleball", value: "PICKLEBALL", emoji: "🏓" },
];

const PLATFORM_OPTIONS: Array<{
  label: string;
  value: ListFilters["platform"] | undefined;
  emoji: string;
}> = [
  { label: "All", value: undefined, emoji: "" },
  { label: "Web", value: "web", emoji: "💻" },
  { label: "Android", value: "android", emoji: "🤖" },
  { label: "iOS", value: "ios", emoji: "🍎" },
];

const STATUS_TEXT: Record<string, string> = {
  CONFIRMED: colors.emerald400,
  PENDING: colors.yellow400,
  CANCELLED: colors.destructive,
};

const SPORT_EMOJI: Record<string, string> = {
  CRICKET: "🏏",
  FOOTBALL: "⚽",
  PICKLEBALL: "🏓",
};

export function AdminBookingsListScreen() {
  const navigation = useNavigation<Nav>();
  const [filters, setFilters] = useState<ListFilters>({
    status: "CONFIRMED",
    page: 1,
    limit: 25,
  });

  const query = useQuery({
    queryKey: ["admin-bookings", filters],
    queryFn: () => adminBookingsApi.list(filters),
    refetchOnWindowFocus: false,
  });

  // Quick-filter helper: match the web's "Today" / "Tomorrow" date
  // chips so admins land on the same default views.
  function todayStr(): string {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  }
  function tomorrowStr(): string {
    return new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata",
    });
  }

  function setFilter<K extends keyof ListFilters>(
    key: K,
    value: ListFilters[K],
  ) {
    setFilters((f) => ({ ...f, [key]: value, page: 1 }));
  }

  const bookings = query.data?.bookings ?? [];
  const total = query.data?.total ?? 0;
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
        {/* Filters card — same chip style as web admin's bookings filter strip. */}
        <View style={styles.filtersCard}>
          <View style={styles.filtersHead}>
            <Filter size={14} color={colors.zinc500} />
            <Text variant="tiny" color={colors.zinc500} style={styles.filtersTitle}>
              FILTERS
            </Text>
            <Text variant="tiny" color={colors.zinc500} style={styles.totalCount}>
              {total} {total === 1 ? "booking" : "bookings"}
            </Text>
          </View>

          {/* Date row */}
          <FilterRow label="Date">
            {[
              { label: "All", value: "" },
              { label: "Today", value: todayStr() },
              { label: "Tomorrow", value: tomorrowStr() },
            ].map((opt) => (
              <Chip
                key={opt.label}
                label={opt.label}
                active={(filters.date ?? "") === opt.value}
                onPress={() => setFilter("date", opt.value || undefined)}
              />
            ))}
          </FilterRow>

          {/* Status row */}
          <FilterRow label="Status">
            {STATUS_OPTIONS.map((opt) => (
              <Chip
                key={opt.label}
                label={opt.label}
                dotColor={opt.dot}
                active={filters.status === opt.value}
                onPress={() => setFilter("status", opt.value)}
              />
            ))}
          </FilterRow>

          {/* Sport row */}
          <FilterRow label="Sport">
            {SPORT_OPTIONS.map((opt) => (
              <Chip
                key={opt.label}
                label={opt.label}
                emoji={opt.emoji}
                active={filters.sport === opt.value}
                onPress={() => setFilter("sport", opt.value)}
              />
            ))}
          </FilterRow>

          {/* Platform row */}
          <FilterRow label="Platform">
            {PLATFORM_OPTIONS.map((opt) => (
              <Chip
                key={opt.label}
                label={opt.label}
                emoji={opt.emoji}
                active={filters.platform === opt.value}
                onPress={() => setFilter("platform", opt.value)}
              />
            ))}
          </FilterRow>
        </View>

        {/* Results */}
        {query.isLoading ? (
          <ListSkeleton />
        ) : query.isError ? (
          <ErrorBlock
            onRetry={() => void query.refetch()}
            message={
              query.error instanceof Error ? query.error.message : null
            }
          />
        ) : bookings.length === 0 ? (
          <EmptyState />
        ) : (
          <View style={styles.list}>
            {bookings.map((b) => (
              <BookingRow
                key={b.id}
                booking={b}
                onPress={() =>
                  navigation.navigate("AdminBookingDetail", { bookingId: b.id })
                }
              />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

// ─── Filter sub-components ──────────────────────────────────────────────────

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.filterRow}>
      <Text variant="tiny" color={colors.zinc600} style={styles.filterLabel}>
        {label.toUpperCase()}
      </Text>
      <View style={styles.chipWrap}>{children}</View>
    </View>
  );
}

function Chip({
  label,
  emoji,
  dotColor,
  active,
  onPress,
}: {
  label: string;
  emoji?: string;
  dotColor?: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        pressed && !active && { opacity: 0.7 },
      ]}
    >
      {dotColor ? (
        <View style={[styles.chipDot, { backgroundColor: dotColor }]} />
      ) : null}
      {emoji ? <Text style={styles.chipEmoji}>{emoji}</Text> : null}
      <Text
        variant="small"
        color={active ? colors.emerald400 : colors.zinc500}
        weight="500"
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Booking card ───────────────────────────────────────────────────────────

function BookingRow({
  booking,
  onPress,
}: {
  booking: AdminBookingListItem;
  onPress: () => void;
}) {
  const statusColor = STATUS_TEXT[booking.status] ?? colors.zinc400;
  const initial =
    booking.user.name?.charAt(0).toUpperCase() ??
    booking.user.phone?.slice(-2) ??
    "—";
  const slotRange = booking.slots.length
    ? formatHoursAsRanges(booking.slots.map((s) => s.startHour))
    : "—";
  const date = formatDateLong(booking.date);
  const sport = sportLabel(booking.courtConfig.sport);
  const courtLabel = booking.courtConfig.label;
  // Partial bookings still owe at venue → small amber chip on the row.
  const venueDue =
    booking.payment?.isPartialPayment &&
    (booking.payment?.remainingAmount ?? 0) > 0
      ? booking.totalAmount - (booking.payment?.advanceAmount ?? 0)
      : 0;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={[styles.avatar, { backgroundColor: "rgba(34, 197, 94, 0.10)" }]}>
        <Text variant="bodyStrong" color={colors.emerald400}>
          {initial}
        </Text>
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowHeader}>
          <Text variant="bodyStrong" style={styles.rowName} numberOfLines={1}>
            {booking.user.name || booking.user.phone || "—"}
          </Text>
          {booking.createdByAdminId ? (
            <View style={styles.adminPill}>
              <Text variant="tiny" weight="600" color={colors.yellow400}>
                ADMIN
              </Text>
            </View>
          ) : null}
        </View>
        <Text variant="small" color={colors.zinc500} numberOfLines={1}>
          {SPORT_EMOJI[booking.courtConfig.sport] ?? "🎯"} {sport} · {courtLabel}
        </Text>
        <View style={styles.rowMeta}>
          <Text variant="tiny" color={colors.zinc400}>
            {date}
          </Text>
          <Text variant="tiny" color={colors.zinc700}>
            ·
          </Text>
          <Text
            variant="tiny"
            color={colors.zinc500}
            style={styles.rowMetaMono}
          >
            {slotRange}
          </Text>
        </View>
      </View>
      <View style={styles.rowRight}>
        <Text variant="bodyStrong">{formatRupees(booking.totalAmount)}</Text>
        <View style={styles.rowStatus}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: statusColor },
            ]}
          />
          <Text variant="tiny" color={statusColor} weight="500">
            {booking.status === "CONFIRMED"
              ? "Confirmed"
              : booking.status === "PENDING"
                ? "Pending"
                : "Cancelled"}
          </Text>
        </View>
        {venueDue > 0 ? (
          <Text variant="tiny" color={colors.yellow400} weight="600">
            {formatRupees(venueDue)} at venue
          </Text>
        ) : null}
        <ChevronRight size={14} color={colors.zinc700} />
      </View>
    </Pressable>
  );
}

// ─── States ─────────────────────────────────────────────────────────────────

function ListSkeleton() {
  return (
    <View style={styles.list}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={40} height={40} rounded="full" />
          <View style={styles.rowBody}>
            <Skeleton width="60%" height={14} />
            <Skeleton width="40%" height={11} />
            <Skeleton width="30%" height={11} />
          </View>
          <View style={styles.rowRight}>
            <Skeleton width={60} height={14} />
            <Skeleton width={50} height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

function EmptyState() {
  return (
    <View style={styles.empty}>
      <SearchIcon size={28} color={colors.zinc700} />
      <Text variant="bodyStrong" color={colors.zinc400} style={styles.emptyTitle}>
        No bookings match
      </Text>
      <Text variant="small" color={colors.zinc600} align="center">
        Try adjusting the date, status, or sport filter above.
      </Text>
    </View>
  );
}

function ErrorBlock({
  onRetry,
  message,
}: {
  onRetry: () => void;
  message?: string | null;
}) {
  return (
    <Pressable onPress={onRetry} style={styles.error}>
      <UserIcon size={22} color={colors.destructive} />
      <View style={{ flex: 1 }}>
        <Text variant="body" color={colors.destructive}>
          Couldn't load bookings. Tap to retry.
        </Text>
        {message ? (
          <Text variant="tiny" color={colors.zinc500} style={{ marginTop: 4 }}>
            {message}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["4"],
  },

  // Filters
  filtersCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["4"],
    gap: spacing["3"],
  },
  filtersHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  filtersTitle: { letterSpacing: 1.5, fontWeight: "700" },
  totalCount: { marginLeft: "auto" },
  filterRow: {
    gap: spacing["2"],
  },
  filterLabel: {
    letterSpacing: 1.5,
    fontWeight: "700",
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["2"],
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc800_50,
  },
  chipActive: {
    borderColor: "rgba(34, 197, 94, 0.30)",
    backgroundColor: "rgba(34, 197, 94, 0.15)",
  },
  chipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chipEmoji: { fontSize: 12 },

  // List
  list: { gap: spacing["2"] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    padding: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: {
    flex: 1,
    gap: spacing["1"],
    minWidth: 0,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
  },
  rowName: { flexShrink: 1 },
  adminPill: {
    paddingHorizontal: spacing["1"],
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(250, 204, 21, 0.30)",
    backgroundColor: "rgba(250, 204, 21, 0.10)",
  },
  rowMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
  },
  rowMetaMono: { fontFamily: "Courier" },
  rowRight: {
    alignItems: "flex-end",
    gap: spacing["1"],
  },
  rowStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1"],
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  // Empty / error
  empty: {
    alignItems: "center",
    gap: spacing["2"],
    padding: spacing["8"],
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  emptyTitle: { marginTop: spacing["2"] },
  error: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    padding: spacing["4"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.30)",
    backgroundColor: "rgba(239, 68, 68, 0.10)",
  },
});
