import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, ShieldCheck, X } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminUtrApi,
  type UtrBookingPayment,
  type UtrCafePayment,
  type UtrType,
} from "../../lib/admin-utr";
import {
  formatDateLong,
  formatHoursAsRanges,
  formatRupees,
  sportLabel,
} from "../../lib/format";

/**
 * Mirrors web /admin/utr-verify. Lists pending UPI_QR booking + cafe
 * payments where the customer submitted a UTR; each row shows the UTR,
 * amount and customer with Verify / Reject. Verify confirms the
 * booking/order; reject cancels it. Amounts are in rupees.
 */
export function AdminUtrVerifyScreen() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["admin", "utr-pending"],
    queryFn: () => adminUtrApi.pending(),
    refetchOnWindowFocus: false,
  });

  const verify = useMutation({
    mutationFn: (v: { paymentId: string; type: UtrType }) =>
      adminUtrApi.verify(v.paymentId, v.type),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "utr-pending"] }),
    onError: (e) =>
      Alert.alert("Verify failed", e instanceof Error ? e.message : "Failed"),
  });

  const reject = useMutation({
    mutationFn: (v: { paymentId: string; type: UtrType }) =>
      adminUtrApi.reject(v.paymentId, v.type),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "utr-pending"] }),
    onError: (e) =>
      Alert.alert("Reject failed", e instanceof Error ? e.message : "Failed"),
  });

  const busyId =
    verify.isPending
      ? verify.variables?.paymentId
      : reject.isPending
        ? reject.variables?.paymentId
        : null;

  function confirmReject(paymentId: string, type: UtrType, who: string) {
    Alert.alert(
      "Reject payment?",
      `This cancels ${who}'s ${type} and marks the payment failed.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reject",
          style: "destructive",
          onPress: () => reject.mutate({ paymentId, type }),
        },
      ],
    );
  }

  const data = query.data;
  const refreshing = (query.isFetching && !query.isLoading) || query.isRefetching;
  const bookingPayments = data?.bookingPayments ?? [];
  const cafePayments = data?.cafePayments ?? [];
  const empty =
    !query.isLoading && bookingPayments.length === 0 && cafePayments.length === 0;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void query.refetch()}
            tintColor={colors.emerald400}
          />
        }
      >
        {/* Stats */}
        {data ? (
          <View style={styles.statsRow}>
            <Stat label="Pending" value={data.stats.totalPending} accent={colors.yellow400} />
            <Stat label="Verified today" value={data.stats.verifiedToday} accent={colors.emerald400} />
            <Stat label="Rejected today" value={data.stats.rejectedToday} accent={colors.destructive} />
          </View>
        ) : null}

        {query.isLoading ? (
          <View style={styles.list}>
            {[0, 1].map((i) => (
              <View key={i} style={styles.skeleton}>
                <Skeleton width="60%" height={16} />
                <Skeleton width="40%" height={12} />
                <Skeleton width="80%" height={12} />
              </View>
            ))}
          </View>
        ) : query.isError ? (
          <Pressable onPress={() => void query.refetch()} style={styles.errorBlock}>
            <Text variant="body" color={colors.destructive}>
              Couldn&apos;t load pending UTRs. Tap to retry.
            </Text>
          </Pressable>
        ) : empty ? (
          <View style={styles.empty}>
            <CheckCircle2 size={32} color={colors.emerald400} />
            <Text variant="bodyStrong" color={colors.zinc300}>
              All caught up
            </Text>
            <Text variant="small" color={colors.zinc500} align="center" style={{ maxWidth: 260 }}>
              No UPI payments waiting for UTR verification.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {bookingPayments.map((p) => (
              <BookingUtrCard
                key={p.id}
                payment={p}
                busy={busyId === p.id}
                onVerify={() => verify.mutate({ paymentId: p.id, type: "booking" })}
                onReject={() =>
                  confirmReject(p.id, "booking", p.booking.userName)
                }
              />
            ))}
            {cafePayments.map((p) => (
              <CafeUtrCard
                key={p.id}
                payment={p}
                busy={busyId === p.id}
                onVerify={() => verify.mutate({ paymentId: p.id, type: "cafe" })}
                onReject={() => confirmReject(p.id, "cafe", p.order.userName)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <View style={styles.statCard}>
      <Text variant="title" weight="700" color={accent}>
        {value}
      </Text>
      <Text variant="tiny" color={colors.zinc500}>
        {label}
      </Text>
    </View>
  );
}

function UtrChip({ utr }: { utr: string | null }) {
  return (
    <View style={styles.utrChip}>
      <Text variant="tiny" weight="700" color={colors.emerald400} style={styles.mono}>
        {utr ?? "—"}
      </Text>
    </View>
  );
}

function Actions({
  busy,
  onVerify,
  onReject,
}: {
  busy: boolean;
  onVerify: () => void;
  onReject: () => void;
}) {
  return (
    <View style={styles.actions}>
      <View style={{ flex: 1 }}>
        <Button
          label="Verify"
          size="sm"
          onPress={onVerify}
          loading={busy}
          fullWidth
          leadingIcon={<ShieldCheck size={14} color={colors.primaryForeground} />}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Button
          label="Reject"
          size="sm"
          variant="destructive"
          onPress={onReject}
          disabled={busy}
          fullWidth
          leadingIcon={<X size={14} color="#fff" />}
        />
      </View>
    </View>
  );
}

function BookingUtrCard({
  payment,
  busy,
  onVerify,
  onReject,
}: {
  payment: UtrBookingPayment;
  busy: boolean;
  onVerify: () => void;
  onReject: () => void;
}) {
  const b = payment.booking;
  const slotRange = b.slots.length ? formatHoursAsRanges(b.slots) : "—";
  return (
    <Card style={styles.card}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {b.userName}
          </Text>
          <Text variant="tiny" color={colors.zinc500} numberOfLines={1}>
            {b.userPhone || b.userEmail}
          </Text>
        </View>
        <View style={styles.typePill}>
          <Text variant="tiny" weight="600" color={colors.emerald400}>
            BOOKING
          </Text>
        </View>
      </View>

      <Text variant="small" color={colors.zinc400}>
        {sportLabel(b.sport)} · {b.courtLabel} · {formatDateLong(b.date)}
      </Text>
      <Text variant="tiny" color={colors.zinc500} style={styles.mono}>
        {slotRange}
      </Text>

      <View style={styles.amountRow}>
        <UtrChip utr={payment.utrNumber} />
        <Text variant="bodyStrong">
          {formatRupees(payment.amount)}
          {payment.isPartialPayment ? " (advance)" : ""}
        </Text>
      </View>

      {payment.utrExpiresAt ? (
        <View style={styles.expiry}>
          <Clock size={12} color={colors.yellow400} />
          <Text variant="tiny" color={colors.yellow400}>
            Expires {formatDateLong(payment.utrExpiresAt)}
          </Text>
        </View>
      ) : null}

      <Actions busy={busy} onVerify={onVerify} onReject={onReject} />
    </Card>
  );
}

function CafeUtrCard({
  payment,
  busy,
  onVerify,
  onReject,
}: {
  payment: UtrCafePayment;
  busy: boolean;
  onVerify: () => void;
  onReject: () => void;
}) {
  const o = payment.order;
  const items = o.items
    .map((i) => `${i.quantity}× ${i.name}`)
    .join(", ");
  return (
    <Card style={styles.card}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {o.userName}
          </Text>
          <Text variant="tiny" color={colors.zinc500} numberOfLines={1}>
            #{o.orderNumber} · {o.userPhone || o.userEmail}
          </Text>
        </View>
        <View style={[styles.typePill, styles.cafePill]}>
          <Text variant="tiny" weight="600" color={colors.yellow400}>
            CAFE
          </Text>
        </View>
      </View>

      <Text variant="small" color={colors.zinc400} numberOfLines={2}>
        {items || "—"}
      </Text>

      <View style={styles.amountRow}>
        <UtrChip utr={payment.utrNumber} />
        <Text variant="bodyStrong">{formatRupees(payment.amount)}</Text>
      </View>

      <Actions busy={busy} onVerify={onVerify} onReject={onReject} />
    </Card>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["10"],
    gap: spacing["3"],
  },
  statsRow: { flexDirection: "row", gap: spacing["2"] },
  statCard: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    gap: 2,
  },
  list: { gap: spacing["3"] },
  card: { padding: spacing["4"], gap: spacing["2"] },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing["2"] },
  typePill: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.emerald500_10,
  },
  cafePill: { backgroundColor: "rgba(250, 204, 21, 0.10)" },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing["1"],
    gap: spacing["2"],
  },
  utrChip: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: colors.emerald500_10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.emerald400_50,
  },
  expiry: { flexDirection: "row", alignItems: "center", gap: spacing["1"] },
  actions: { flexDirection: "row", gap: spacing["2"], marginTop: spacing["2"] },
  mono: { fontFamily: "Courier" },
  skeleton: {
    padding: spacing["4"],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    gap: spacing["2"],
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
    borderColor: colors.destructive_30,
    backgroundColor: colors.destructive_10,
  },
});
