import { useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  QrCode,
  ScanLine,
  Search,
  XCircle,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminCheckinApi,
  type CheckinByQrBooking,
  type CheckinTodayItem,
} from "../../lib/admin-checkin";
import { AdminApiError } from "../../lib/admin-api";
import {
  formatHoursAsRanges,
  formatRupees,
  sportLabel,
} from "../../lib/format";

const SPORT_EMOJI: Record<string, string> = {
  CRICKET: "🏏",
  FOOTBALL: "⚽",
  PICKLEBALL: "🏓",
};

/**
 * Mirrors the web /admin/checkin page, with two paths:
 *
 *   1. Today list — every CONFIRMED booking dated today, with a quick
 *      filter + per-row "Check in" button. This is the primary path
 *      for floor staff because it doesn't require the customer to
 *      have their QR ready.
 *
 *   2. QR token entry — paste or type a token into the input bar to
 *      land on the same booking detail + check-in card the web shows
 *      after a camera scan.
 *
 * The live camera scanner from the web (uses navigator.mediaDevices)
 * is intentionally not ported. Camera-permission UX inside RN tabs is
 * fragile, and the today-list covers the same workflow without it.
 */
export function AdminCheckinScreen() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [activeBooking, setActiveBooking] =
    useState<CheckinByQrBooking | null>(null);

  const today = useQuery({
    queryKey: ["admin-checkin-today"],
    queryFn: () => adminCheckinApi.today(),
    refetchOnWindowFocus: false,
  });

  const refreshing =
    (today.isFetching && !today.isLoading) || today.isRefetching;

  const lookup = useMutation({
    mutationFn: (qrToken: string) => adminCheckinApi.byQr(qrToken),
    onSuccess: (data) => setActiveBooking(data.booking),
    onError: (err) =>
      Alert.alert(
        "Lookup failed",
        err instanceof AdminApiError ? err.message : "Try again.",
      ),
  });

  const checkIn = useMutation({
    mutationFn: (qrToken: string) => adminCheckinApi.checkIn(qrToken),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-checkin-today"] });
      Alert.alert("Checked in", "Customer marked checked-in.");
      setActiveBooking(null);
      setTokenInput("");
    },
    onError: (err) =>
      Alert.alert(
        "Couldn't check in",
        err instanceof AdminApiError ? err.message : "Try again.",
      ),
  });

  const filtered = useMemo(() => {
    const items = today.data?.bookings ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((b) => {
      const name = b.user.name?.toLowerCase() ?? "";
      const phone = b.user.phone ?? "";
      return name.includes(q) || phone.includes(q);
    });
  }, [today.data, search]);

  const checkedInCount = useMemo(
    () => (today.data?.bookings ?? []).filter((b) => b.checkedInAt).length,
    [today.data],
  );

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void today.refetch()}
            tintColor={colors.yellow400}
          />
        }
      >
        {/* QR token entry */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <ScanLine size={14} color={colors.zinc500} />
            <Text variant="tiny" color={colors.zinc500} style={styles.cardTitle}>
              SCAN OR PASTE QR TOKEN
            </Text>
          </View>
          <View style={styles.tokenRow}>
            <TextInput
              value={tokenInput}
              onChangeText={setTokenInput}
              placeholder="Paste qrToken here"
              placeholderTextColor={colors.zinc600}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <Pressable
              onPress={() => {
                const t = tokenInput.trim();
                if (!t) {
                  Alert.alert("Token required", "Paste or scan a QR token.");
                  return;
                }
                lookup.mutate(t);
              }}
              disabled={lookup.isPending || !tokenInput.trim()}
              style={({ pressed }) => [
                styles.lookupBtn,
                (lookup.isPending || !tokenInput.trim()) && { opacity: 0.5 },
                pressed && { opacity: 0.7 },
              ]}
            >
              <QrCode size={16} color={colors.yellow400} />
              <Text variant="small" color={colors.yellow400} weight="600">
                {lookup.isPending ? "…" : "Look up"}
              </Text>
            </Pressable>
          </View>
          <Text variant="tiny" color={colors.zinc600}>
            The same token the web /admin/checkin page reads from the
            URL after a scan.
          </Text>
        </View>

        {/* Active booking card — appears when a token resolves */}
        {activeBooking ? (
          <ActiveBookingCard
            booking={activeBooking}
            isCheckingIn={checkIn.isPending}
            onCheckIn={() => checkIn.mutate(activeBooking.qrToken)}
            onClose={() => setActiveBooking(null)}
          />
        ) : null}

        {/* Today list */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Clock size={14} color={colors.zinc500} />
            <Text variant="tiny" color={colors.zinc500} style={styles.cardTitle}>
              TODAY · {today.data?.date ?? "—"}
            </Text>
            {today.data ? (
              <Text variant="tiny" color={colors.emerald400} style={styles.countPill}>
                {checkedInCount}/{today.data.bookings.length} in
              </Text>
            ) : null}
          </View>

          <View style={styles.searchRow}>
            <Search size={14} color={colors.zinc500} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search name or phone"
              placeholderTextColor={colors.zinc600}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.searchInput}
            />
          </View>

          {today.isLoading ? (
            <ListSkeleton />
          ) : today.isError ? (
            <Pressable
              onPress={() => void today.refetch()}
              style={styles.errorBlock}
            >
              <Text variant="body" color={colors.destructive}>
                Couldn't load today's bookings. Tap to retry.
              </Text>
              <Text variant="tiny" color={colors.zinc500}>
                {today.error instanceof Error
                  ? today.error.message
                  : "Unknown error"}
              </Text>
            </Pressable>
          ) : filtered.length === 0 ? (
            <View style={styles.empty}>
              <Text variant="bodyStrong" color={colors.zinc300}>
                {search.trim() ? "No matches" : "No bookings today"}
              </Text>
              <Text variant="tiny" color={colors.zinc500} align="center">
                {search.trim()
                  ? "Try a different name or phone fragment."
                  : "When customers book today, they'll appear here."}
              </Text>
            </View>
          ) : (
            <View style={styles.list}>
              {filtered.map((b) => (
                <CheckinRow
                  key={b.id}
                  booking={b}
                  onPress={() => lookup.mutate(b.qrToken)}
                  onCheckIn={() => checkIn.mutate(b.qrToken)}
                  isCheckingIn={
                    checkIn.isPending && checkIn.variables === b.qrToken
                  }
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

function CheckinRow({
  booking,
  onPress,
  onCheckIn,
  isCheckingIn,
}: {
  booking: CheckinTodayItem;
  onPress: () => void;
  onCheckIn: () => void;
  isCheckingIn: boolean;
}) {
  const sport = sportLabel(booking.courtConfig.sport);
  const sportE = SPORT_EMOJI[booking.courtConfig.sport] ?? "🎯";
  const slotRange = booking.slots.length
    ? formatHoursAsRanges(booking.slots)
    : "—";
  const isCheckedIn = !!booking.checkedInAt;

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.rowMain,
          pressed && { opacity: 0.7 },
        ]}
      >
        <View
          style={[
            styles.avatar,
            isCheckedIn && {
              backgroundColor: "rgba(34, 197, 94, 0.10)",
              borderColor: "rgba(34, 197, 94, 0.30)",
            },
          ]}
        >
          {isCheckedIn ? (
            <CheckCircle2 size={18} color={colors.emerald400} />
          ) : (
            <Text variant="bodyStrong" color={colors.yellow400}>
              {(booking.user.name?.charAt(0) || "—").toUpperCase()}
            </Text>
          )}
        </View>
        <View style={styles.rowBody}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {booking.user.name || booking.user.phone || "—"}
          </Text>
          <Text variant="small" color={colors.zinc500} numberOfLines={1}>
            {sportE} {sport} · {booking.courtConfig.label}
          </Text>
          <Text
            variant="tiny"
            color={isCheckedIn ? colors.emerald400 : colors.zinc500}
            style={styles.rowMetaMono}
          >
            {slotRange}
          </Text>
        </View>
        <ChevronRight size={14} color={colors.zinc700} />
      </Pressable>

      {/* Per-row action — primary path for staffers who already see
          the customer in front of them. Disabled (and shows a
          confirmation pill) once the booking is checked in. */}
      {isCheckedIn ? (
        <View style={[styles.checkBtn, styles.checkBtnDone]}>
          <CheckCircle2 size={14} color={colors.emerald400} />
          <Text variant="tiny" color={colors.emerald400} weight="600">
            Checked in
          </Text>
        </View>
      ) : (
        <Pressable
          onPress={onCheckIn}
          disabled={isCheckingIn}
          style={({ pressed }) => [
            styles.checkBtn,
            styles.checkBtnPrimary,
            isCheckingIn && { opacity: 0.5 },
            pressed && { opacity: 0.7 },
          ]}
        >
          <CheckCircle2 size={14} color={colors.yellow400} />
          <Text variant="tiny" color={colors.yellow400} weight="600">
            {isCheckingIn ? "…" : "Check in"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function ActiveBookingCard({
  booking,
  onCheckIn,
  isCheckingIn,
  onClose,
}: {
  booking: CheckinByQrBooking;
  onCheckIn: () => void;
  isCheckingIn: boolean;
  onClose: () => void;
}) {
  const sport = sportLabel(booking.courtConfig.sport);
  const sportE = SPORT_EMOJI[booking.courtConfig.sport] ?? "🎯";
  const slotRange = booking.slots.length
    ? formatHoursAsRanges(booking.slots.map((s) => s.startHour))
    : "—";
  const isConfirmed = booking.status === "CONFIRMED";
  const isCheckedIn = !!booking.checkedInAt;

  return (
    <View style={styles.activeCard}>
      <View style={styles.activeHeader}>
        <Text variant="bodyStrong">QR lookup</Text>
        <Pressable onPress={onClose} hitSlop={8}>
          <XCircle size={16} color={colors.zinc500} />
        </Pressable>
      </View>

      {!isConfirmed ? (
        <View style={[styles.banner, styles.bannerError]}>
          <XCircle size={14} color={colors.destructive} />
          <Text variant="small" color={colors.destructive}>
            Status {booking.status} — cannot check in.
          </Text>
        </View>
      ) : null}

      {isCheckedIn ? (
        <View style={[styles.banner, styles.bannerOk]}>
          <CheckCircle2 size={14} color={colors.emerald400} />
          <Text variant="small" color={colors.emerald400}>
            Already checked in.
          </Text>
        </View>
      ) : null}

      <View style={styles.activeBody}>
        <Text variant="bodyStrong">
          {sportE} {sport} · {booking.courtConfig.label}
        </Text>
        <Text variant="small" color={colors.zinc400}>
          {booking.user.name || booking.user.phone || "Guest"}
        </Text>
        <Text variant="small" color={colors.zinc500} style={styles.rowMetaMono}>
          {slotRange}
        </Text>
        <Text variant="small" color={colors.zinc500}>
          {formatRupees(booking.totalAmount)} ·{" "}
          {booking.payment
            ? `${booking.payment.status} · ${booking.payment.method.replace("_", " ")}`
            : "No payment"}
        </Text>
      </View>

      {isConfirmed && !isCheckedIn ? (
        <Pressable
          onPress={onCheckIn}
          disabled={isCheckingIn}
          style={({ pressed }) => [
            styles.activeAction,
            isCheckingIn && { opacity: 0.5 },
            pressed && { opacity: 0.7 },
          ]}
        >
          <CheckCircle2 size={16} color={colors.emerald400} />
          <Text variant="small" color={colors.emerald400} weight="600">
            {isCheckingIn ? "Checking in…" : "Confirm check-in"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ListSkeleton() {
  return (
    <View style={styles.list}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.row}>
          <View style={styles.rowMain}>
            <Skeleton width={40} height={40} rounded="full" />
            <View style={styles.rowBody}>
              <Skeleton width="60%" height={14} />
              <Skeleton width="40%" height={11} />
              <Skeleton width="30%" height={11} />
            </View>
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
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["4"],
    gap: spacing["3"],
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
  },
  cardTitle: { letterSpacing: 1.5, fontWeight: "700" },
  countPill: {
    marginLeft: "auto",
    paddingHorizontal: spacing["2"],
    paddingVertical: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(34, 197, 94, 0.30)",
    backgroundColor: "rgba(34, 197, 94, 0.10)",
  },
  tokenRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.zinc700,
    borderRadius: 8,
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2.5"],
    color: colors.foreground,
    backgroundColor: colors.background,
    fontSize: 14,
    fontFamily: "Courier",
  },
  lookupBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2.5"],
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(250, 204, 21, 0.30)",
    backgroundColor: "rgba(250, 204, 21, 0.10)",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    borderWidth: 1,
    borderColor: colors.zinc800,
    borderRadius: 8,
    paddingHorizontal: spacing["3"],
    backgroundColor: colors.background,
  },
  searchInput: {
    flex: 1,
    paddingVertical: spacing["2.5"],
    color: colors.foreground,
    fontSize: 14,
  },
  list: { gap: spacing["2"] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    padding: spacing["2.5"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
  },
  rowBody: { flex: 1, gap: 2, minWidth: 0 },
  rowMetaMono: { fontFamily: "Courier" },
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
  checkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
    paddingHorizontal: spacing["2.5"],
    paddingVertical: spacing["2"],
    borderRadius: 999,
    borderWidth: 1,
  },
  checkBtnPrimary: {
    borderColor: "rgba(250, 204, 21, 0.40)",
    backgroundColor: "rgba(250, 204, 21, 0.12)",
  },
  checkBtnDone: {
    borderColor: "rgba(34, 197, 94, 0.30)",
    backgroundColor: "rgba(34, 197, 94, 0.10)",
  },
  empty: {
    alignItems: "center",
    gap: spacing["1"],
    padding: spacing["6"],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
  },
  errorBlock: {
    padding: spacing["4"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.30)",
    backgroundColor: "rgba(239, 68, 68, 0.10)",
    gap: spacing["1"],
  },
  activeCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: "rgba(250, 204, 21, 0.30)",
    backgroundColor: "rgba(250, 204, 21, 0.06)",
    padding: spacing["4"],
    gap: spacing["3"],
  },
  activeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    borderRadius: 8,
  },
  bannerError: {
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.30)",
    backgroundColor: "rgba(239, 68, 68, 0.10)",
  },
  bannerOk: {
    borderWidth: 1,
    borderColor: "rgba(34, 197, 94, 0.30)",
    backgroundColor: "rgba(34, 197, 94, 0.10)",
  },
  activeBody: { gap: spacing["1"] },
  activeAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["2"],
    paddingVertical: spacing["3"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(34, 197, 94, 0.30)",
    backgroundColor: "rgba(34, 197, 94, 0.10)",
  },
});
