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
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminBookingsApi,
  type AdminBookingListItem,
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
  "AdminUnconfirmedBookingsList"
>;

const SPORT_EMOJI: Record<string, string> = {
  CRICKET: "🏏",
  FOOTBALL: "⚽",
  PICKLEBALL: "🏓",
};

/**
 * Mirrors web /admin/bookings/unconfirmed. The composite filter
 * (status PENDING + payment.status PENDING + method UPI_QR/CASH) is
 * applied server-side; this screen has no filter chips because the
 * dataset is intentionally narrow — bookings literally awaiting an
 * admin to verify a screenshot or collect cash.
 */
export function AdminUnconfirmedBookingsListScreen() {
  const navigation = useNavigation<Nav>();

  const query = useQuery({
    queryKey: ["admin-unconfirmed-bookings"],
    queryFn: () => adminBookingsApi.unconfirmed({ limit: 50 }),
    refetchOnWindowFocus: false,
  });

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
        {/* Hero summary — what this queue is for */}
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <AlertCircle size={20} color={colors.yellow400} />
          </View>
          <View style={styles.heroBody}>
            <Text variant="bodyStrong">Awaiting verification</Text>
            <Text variant="small" color={colors.zinc500}>
              UPI QR + cash bookings the customer marked paid. Open
              each one to verify the screenshot or collect cash, then
              tap Confirm.
            </Text>
          </View>
        </View>

        {/* Count chip — only shown for the success path. While
            loading we show "…", on error we suppress entirely so it
            doesn't say "All caught up" alongside an error block
            (which reads as a contradiction). */}
        {!query.isError ? (
          <View style={styles.countChip}>
            <Clock size={14} color={colors.yellow400} />
            <Text variant="small" color={colors.yellow400} weight="600">
              {query.isLoading
                ? "…"
                : total === 0
                  ? "All caught up"
                  : `${total} unconfirmed`}
            </Text>
          </View>
        ) : null}

        {/* List */}
        {query.isLoading ? (
          <ListSkeleton />
        ) : query.isError ? (
          <Pressable
            onPress={() => void query.refetch()}
            style={styles.errorBlock}
          >
            <Text variant="body" color={colors.destructive}>
              Couldn't load unconfirmed bookings. Tap to retry.
            </Text>
            <Text variant="tiny" color={colors.zinc500}>
              {query.error instanceof Error
                ? query.error.message
                : "Unknown error"}
            </Text>
          </Pressable>
        ) : bookings.length === 0 ? (
          <View style={styles.empty}>
            <CheckCircle2 size={32} color={colors.emerald400} />
            <Text variant="bodyStrong" color={colors.zinc300}>
              No unconfirmed bookings
            </Text>
            <Text
              variant="small"
              color={colors.zinc500}
              align="center"
              style={{ maxWidth: 260 }}
            >
              Every UPI / cash payment is verified. Pull to refresh
              when a new one comes in.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {bookings.map((b) => (
              <UnconfirmedRow
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

function UnconfirmedRow({
  booking,
  onPress,
}: {
  booking: AdminBookingListItem;
  onPress: () => void;
}) {
  const initial =
    booking.user.name?.charAt(0).toUpperCase() ??
    booking.user.phone?.slice(-2) ??
    "—";
  const sport = sportLabel(booking.courtConfig.sport);
  const sportE = SPORT_EMOJI[booking.courtConfig.sport] ?? "🎯";
  const slotRange = booking.slots.length
    ? formatHoursAsRanges(booking.slots.map((s) => s.startHour))
    : "—";
  const date = formatDateLong(booking.date);
  const methodLabel =
    booking.payment?.method === "UPI_QR" ? "UPI QR" : "Cash";

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={styles.avatar}>
        <Text variant="bodyStrong" color={colors.yellow400}>
          {initial}
        </Text>
      </View>
      <View style={styles.rowBody}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {booking.user.name || booking.user.phone || "—"}
        </Text>
        <Text variant="small" color={colors.zinc500} numberOfLines={1}>
          {sportE} {sport} · {booking.courtConfig.label}
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
        <View style={styles.methodPill}>
          <Text variant="tiny" color={colors.yellow400} weight="600">
            {methodLabel}
          </Text>
        </View>
        <ChevronRight size={14} color={colors.zinc700} />
      </View>
    </Pressable>
  );
}

function ListSkeleton() {
  return (
    <View style={styles.list}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={40} height={40} rounded="full" />
          <View style={styles.rowBody}>
            <Skeleton width="60%" height={14} />
            <Skeleton width="40%" height={11} />
            <Skeleton width="30%" height={11} />
          </View>
          <View style={styles.rowRight}>
            <Skeleton width={60} height={14} />
            <Skeleton width={45} height={16} rounded="full" />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  hero: {
    flexDirection: "row",
    gap: spacing["3"],
    padding: spacing["4"],
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: "rgba(250, 204, 21, 0.30)",
    backgroundColor: "rgba(250, 204, 21, 0.06)",
  },
  heroIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(250, 204, 21, 0.40)",
    backgroundColor: "rgba(250, 204, 21, 0.10)",
  },
  heroBody: { flex: 1, gap: spacing["1"] },
  countChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
    alignSelf: "flex-start",
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(250, 204, 21, 0.30)",
    backgroundColor: "rgba(250, 204, 21, 0.10)",
  },
  list: { gap: spacing["2"] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    padding: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(250, 204, 21, 0.20)",
    backgroundColor: colors.zinc900,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(250, 204, 21, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(250, 204, 21, 0.30)",
  },
  rowBody: { flex: 1, gap: spacing["1"], minWidth: 0 },
  rowMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
  },
  rowMetaMono: { fontFamily: "Courier" },
  rowRight: { alignItems: "flex-end", gap: spacing["1"] },
  methodPill: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(250, 204, 21, 0.30)",
    backgroundColor: "rgba(250, 204, 21, 0.10)",
  },
  empty: {
    alignItems: "center",
    gap: spacing["2"],
    padding: spacing["8"],
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
