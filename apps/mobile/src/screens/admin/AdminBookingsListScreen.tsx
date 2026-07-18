import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Filter,
  Plus,
  Search as SearchIcon,
  User as UserIcon,
  X as XIcon,
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

// Multi-select chip option. Each non-ALL row toggles in/out of the
// list; the ALL row clears the list (= "no filter"). Mirrors the
// web /admin/bookings chip rows. "Completed" is intentionally
// omitted from the Status row — same as the web, the Absent +
// Confirmed pair already covers the operational case.
type ChipOption<V extends string> = {
  label: string;
  value: V;
  dot?: string;
  emoji?: string;
};

const STATUS_OPTIONS: Array<ChipOption<"ALL" | "CONFIRMED" | "PENDING" | "CANCELLED" | "ABSENT">> = [
  { label: "All", value: "ALL" },
  { label: "Confirmed", value: "CONFIRMED", dot: colors.emerald400 },
  { label: "Pending", value: "PENDING", dot: colors.yellow400 },
  { label: "Cancelled", value: "CANCELLED", dot: colors.destructive },
  { label: "Absent", value: "ABSENT", dot: colors.warning },
];

// Sort options — mirrors the web admin's Sort row. Single-select.
const SORT_OPTIONS: Array<{
  label: string;
  value: NonNullable<ListFilters["sort"]>;
}> = [
  { label: "Booked at", value: "createdAt" },
  { label: "Booking date", value: "date" },
];

const SPORT_OPTIONS: Array<ChipOption<"ALL" | "CRICKET" | "FOOTBALL" | "PICKLEBALL">> = [
  { label: "All", value: "ALL", emoji: "" },
  { label: "Cricket", value: "CRICKET", emoji: "🏏" },
  { label: "Football", value: "FOOTBALL", emoji: "⚽" },
  { label: "Pickleball", value: "PICKLEBALL", emoji: "🏓" },
];

const PLATFORM_OPTIONS: Array<ChipOption<"ALL" | "web" | "android" | "ios">> = [
  { label: "All", value: "ALL", emoji: "" },
  { label: "Web", value: "web", emoji: "💻" },
  { label: "Android", value: "android", emoji: "🤖" },
  { label: "iOS", value: "ios", emoji: "🍎" },
];

const PAYMENT_OPTIONS: Array<ChipOption<"ALL" | "completed" | "pending">> = [
  { label: "All", value: "ALL" },
  { label: "Completed", value: "completed", dot: colors.emerald400 },
  { label: "Pending", value: "pending", dot: colors.warning },
];

// Toggle a value in/out of a multi-select filter list. "ALL" is
// exclusive — clicking it clears the list (= no filter); clicking
// any other value adds/removes from the current list.
function toggleMulti<V extends string>(
  current: V[] | undefined,
  value: V | "ALL",
): V[] | undefined {
  if (value === "ALL") return undefined;
  const list = current ?? [];
  if (list.includes(value as V)) {
    const next = list.filter((v) => v !== value);
    return next.length > 0 ? next : undefined;
  }
  return [...list, value as V];
}

// Active state for a chip given the current filter list. "ALL" is
// active when the list is empty / undefined; specific values are
// active when present in the list.
function isChipActive<V extends string>(
  current: V[] | undefined,
  value: V | "ALL",
): boolean {
  if (value === "ALL") return !current || current.length === 0;
  return current?.includes(value as V) ?? false;
}

const STATUS_TEXT: Record<string, string> = {
  CONFIRMED: colors.emerald400,
  PENDING: colors.yellow400,
  CANCELLED: colors.destructive,
  COMPLETED: colors.emerald400,
  ABSENT: colors.warning,
};

const SPORT_EMOJI: Record<string, string> = {
  CRICKET: "🏏",
  FOOTBALL: "⚽",
  PICKLEBALL: "🏓",
};

export function AdminBookingsListScreen() {
  const navigation = useNavigation<Nav>();
  const [filters, setFilters] = useState<ListFilters>({
    // Default to the front-desk working view: live + no-show.
    // Mirrors the web /admin/bookings default. User can deselect /
    // clear via the chips below.
    status: ["CONFIRMED", "ABSENT"],
    page: 1,
    limit: 25,
  });
  // Filters card collapsed by default — five rows of chips were
  // crowding out the actual booking list. Auto-expand once when the
  // user has any non-default filter applied.
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // Customer search input. Kept as a local controlled value so each
  // keystroke doesn't fire a query; we debounce 300ms before
  // pushing into `filters.q`. Same UX as the web /admin/bookings
  // search field — name / phone / email substring match.
  const [searchInput, setSearchInput] = useState("");
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = setTimeout(() => {
      const trimmed = searchInput.trim();
      setFilters((f) => {
        // Avoid no-op state churn (keeps the React Query cache key stable
        // when the user types and re-types the same string).
        if ((f.q ?? "") === trimmed) return f;
        return { ...f, q: trimmed || undefined, page: 1 };
      });
    }, 300);
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [searchInput]);

  const query = useQuery({
    queryKey: ["admin-bookings", filters],
    queryFn: () => adminBookingsApi.list(filters),
    refetchOnWindowFocus: false,
  });

  // Lightweight count of the unconfirmed queue. Drives the amber
  // shortcut pill at the top of the screen so the staffer sees how
  // many UPI/cash payments are waiting on them without opening the
  // dedicated view. Re-fetched on focus so the count stays fresh
  // when navigating back.
  const unconfirmedCount = useQuery({
    queryKey: ["admin-unconfirmed-count"],
    queryFn: () =>
      adminBookingsApi.unconfirmed({ limit: 1 }).then((r) => r.total),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
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
        {/* + New Booking — primary action above the unconfirmed
            queue. Mirrors the web "+ New Booking" button on the top
            of /admin/bookings; pushes onto the AdminCreateBooking
            screen which mirrors the web form. */}
        <Pressable
          onPress={() => navigation.navigate("AdminCreateBooking")}
          style={({ pressed }) => [
            styles.newBookingBtn,
            pressed && { opacity: 0.85 },
          ]}
        >
          <Plus size={16} color={colors.background} />
          <Text variant="bodyStrong" color={colors.background}>
            New Booking
          </Text>
        </Pressable>

        {/* Unconfirmed shortcut — separate from the Pending status
            chip below. The Pending chip filters this list by
            booking.status; the Unconfirmed pill jumps to a dedicated
            screen with the composite filter the web uses
            (status=PENDING + payment.status=PENDING + method
            UPI_QR/CASH) — the actionable "needs admin" queue. */}
        <Pressable
          onPress={() => navigation.navigate("AdminUnconfirmedBookingsList")}
          style={({ pressed }) => [
            styles.unconfirmedShortcut,
            pressed && { opacity: 0.7 },
          ]}
        >
          <View style={styles.unconfirmedIconWrap}>
            <AlertCircle size={16} color={colors.yellow400} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong" color={colors.yellow400}>
              Unconfirmed payments
              {unconfirmedCount.data !== undefined &&
              unconfirmedCount.data > 0
                ? ` (${unconfirmedCount.data})`
                : ""}
            </Text>
            <Text variant="tiny" color={colors.zinc500}>
              UPI / cash payments awaiting verification
            </Text>
          </View>
          <ChevronRight size={16} color={colors.yellow400} />
        </Pressable>

        {/* Filters card — collapsed by default so the booking list
            isn't shoved off-screen by 5 stacked chip rows. The
            header stays visible always: tap to expand, "active"
            badge shows whenever the current filters diverge from
            the defaults so the staffer never loses sight of an
            applied filter. */}
        <View style={styles.filtersCard}>
          <Pressable
            onPress={() => setFiltersExpanded((v) => !v)}
            style={({ pressed }) => [
              styles.filtersHead,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Filter size={14} color={colors.zinc500} />
            <Text variant="tiny" color={colors.zinc500} style={styles.filtersTitle}>
              FILTERS
            </Text>
            {(() => {
              // Default-aware count: status=[CONFIRMED, ABSENT] is
              // the landing default (the front-desk working view)
              // and shouldn't be counted as an "active" filter.
              // Anything other than the exact two-element default
              // set does count.
              const status = filters.status ?? [];
              const statusIsDefault =
                status.length === 2 &&
                status.includes("CONFIRMED") &&
                status.includes("ABSENT");
              const activeCount =
                (!statusIsDefault ? 1 : 0) +
                (filters.sport && filters.sport.length > 0 ? 1 : 0) +
                (filters.date ? 1 : 0) +
                (filters.platform && filters.platform.length > 0 ? 1 : 0) +
                (filters.payment && filters.payment.length > 0 ? 1 : 0);
              return activeCount > 0 ? (
                <View style={styles.activeBadge}>
                  <Text
                    variant="tiny"
                    weight="700"
                    color={colors.emerald400}
                  >
                    {activeCount}
                  </Text>
                </View>
              ) : null;
            })()}
            <Text variant="tiny" color={colors.zinc500} style={styles.totalCount}>
              {total} {total === 1 ? "booking" : "bookings"}
            </Text>
            {filtersExpanded ? (
              <ChevronUp size={14} color={colors.zinc500} />
            ) : (
              <ChevronDown size={14} color={colors.zinc500} />
            )}
          </Pressable>

          {filtersExpanded ? (
            <View style={styles.filtersBody}>
              {/* Customer search — name / phone / email substring.
                  Debounced 300ms so each keystroke doesn't trip a
                  network round-trip. Mirror of the web search box. */}
              <View style={styles.searchRow}>
                <SearchIcon
                  size={14}
                  color={colors.zinc500}
                  style={styles.searchIcon}
                />
                <TextInput
                  value={searchInput}
                  onChangeText={setSearchInput}
                  placeholder="Search by name, phone, or email"
                  placeholderTextColor={colors.zinc600}
                  style={styles.searchInput}
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="search"
                />
                {searchInput.length > 0 && (
                  <Pressable
                    onPress={() => setSearchInput("")}
                    style={styles.searchClear}
                    hitSlop={8}
                    accessibilityLabel="Clear search"
                  >
                    <XIcon size={14} color={colors.zinc400} />
                  </Pressable>
                )}
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

              {/* Status row — multi-select; "All" clears the picks.
                  Default is Confirmed + Absent (the front-desk
                  working view). */}
              <FilterRow label="Status">
                {STATUS_OPTIONS.map((opt) => (
                  <Chip
                    key={opt.label}
                    label={opt.label}
                    dotColor={opt.dot}
                    active={isChipActive(filters.status, opt.value)}
                    onPress={() =>
                      setFilter(
                        "status",
                        toggleMulti(filters.status, opt.value),
                      )
                    }
                  />
                ))}
              </FilterRow>

              {/* Sport row — multi-select. */}
              <FilterRow label="Sport">
                {SPORT_OPTIONS.map((opt) => (
                  <Chip
                    key={opt.label}
                    label={opt.label}
                    emoji={opt.emoji}
                    active={isChipActive(filters.sport, opt.value)}
                    onPress={() =>
                      setFilter(
                        "sport",
                        toggleMulti(filters.sport, opt.value),
                      )
                    }
                  />
                ))}
              </FilterRow>

              {/* Platform row — multi-select. */}
              <FilterRow label="Platform">
                {PLATFORM_OPTIONS.map((opt) => (
                  <Chip
                    key={opt.label}
                    label={opt.label}
                    emoji={opt.emoji}
                    active={isChipActive(filters.platform, opt.value)}
                    onPress={() =>
                      setFilter(
                        "platform",
                        toggleMulti(filters.platform, opt.value),
                      )
                    }
                  />
                ))}
              </FilterRow>

              {/* Payment row — completion state on top of Status.
                  Multi-select syntactically; server collapses both
                  values selected together to "no filter." */}
              <FilterRow label="Payment">
                {PAYMENT_OPTIONS.map((opt) => (
                  <Chip
                    key={opt.label}
                    label={opt.label}
                    dotColor={opt.dot}
                    active={isChipActive(filters.payment, opt.value)}
                    onPress={() =>
                      setFilter(
                        "payment",
                        toggleMulti(filters.payment, opt.value),
                      )
                    }
                  />
                ))}
              </FilterRow>

              {/* Sort row — Booked-at (default) vs Booking-date. */}
              <FilterRow label="Sort by">
                {SORT_OPTIONS.map((opt) => (
                  <Chip
                    key={opt.value}
                    label={opt.label}
                    active={(filters.sort ?? "createdAt") === opt.value}
                    onPress={() =>
                      setFilter(
                        "sort",
                        opt.value === "createdAt" ? undefined : "date",
                      )
                    }
                  />
                ))}
              </FilterRow>

              {/* Clear-all only renders when at least one filter is
                  off-default — otherwise it'd be a no-op and just
                  add visual noise. Status default is the
                  Confirmed+Absent pair; we treat any other set
                  (different items / extra items / missing items)
                  as "touched." */}
              {(() => {
                const status = filters.status ?? [];
                const statusIsDefault =
                  status.length === 2 &&
                  status.includes("CONFIRMED") &&
                  status.includes("ABSENT");
                return (
                  !statusIsDefault ||
                  (filters.sport && filters.sport.length > 0) ||
                  filters.date ||
                  (filters.platform && filters.platform.length > 0) ||
                  (filters.payment && filters.payment.length > 0) ||
                  filters.sort ||
                  filters.q
                );
              })() && (
                <Pressable
                  onPress={() => {
                    setSearchInput("");
                    setFilters({
                      status: ["CONFIRMED", "ABSENT"],
                      sport: undefined,
                      date: undefined,
                      platform: undefined,
                      payment: undefined,
                      sort: undefined,
                      q: undefined,
                      page: 1,
                      limit: 25,
                    });
                  }}
                  style={({ pressed }) => [
                    styles.clearAllBtn,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <XIcon size={12} color={colors.zinc400} />
                  <Text variant="tiny" color={colors.zinc400} weight="600">
                    Clear all
                  </Text>
                </Pressable>
              )}
            </View>
          ) : null}
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

  // + New Booking — primary CTA at the top of the list. Emerald
  // background mirrors the web admin's "+ New Booking" button so
  // muscle memory across the two surfaces stays the same.
  newBookingBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["1.5"],
    paddingVertical: spacing["3"],
    borderRadius: radius.xl,
    backgroundColor: colors.emerald400,
  },

  // Unconfirmed shortcut
  unconfirmedShortcut: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    padding: spacing["4"],
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: "rgba(250, 204, 21, 0.30)",
    backgroundColor: "rgba(250, 204, 21, 0.06)",
  },
  unconfirmedIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(250, 204, 21, 0.40)",
    backgroundColor: "rgba(250, 204, 21, 0.10)",
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
  filtersBody: {
    gap: spacing["3"],
    paddingTop: spacing["3"],
    borderTopWidth: 1,
    borderTopColor: colors.zinc800,
  },
  // Customer search input — single row at the top of the filters
  // body. SearchIcon + TextInput + optional clear (X) button.
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: "rgba(24, 24, 27, 0.50)",
    paddingHorizontal: spacing["2.5"],
  },
  searchIcon: {
    marginRight: spacing["2"],
  },
  searchInput: {
    flex: 1,
    paddingVertical: spacing["2"],
    color: colors.foreground,
    fontSize: 13,
  },
  searchClear: {
    marginLeft: spacing["1"],
    padding: 4,
  },
  // Small green pill that surfaces the active-filter count next to
  // the FILTERS header when the strip is collapsed. Visible when at
  // least one filter is non-default (status != CONFIRMED counts).
  activeBadge: {
    minWidth: 20,
    height: 16,
    paddingHorizontal: 6,
    borderRadius: 999,
    backgroundColor: "rgba(16, 185, 129, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  clearAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: spacing["2.5"],
    paddingVertical: spacing["1.5"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
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
