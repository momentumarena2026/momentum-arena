import { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  CalendarDays,
  CheckCircle2,
  Clock,
  CreditCard,
  History,
  IndianRupee,
  Phone,
  Receipt,
  Smartphone,
  XCircle,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminBookingsApi,
  type AdminBookingDetail,
  AdminApiError,
} from "../../lib/admin-bookings";
import {
  formatDateLong,
  formatHoursAsRanges,
  formatRupees,
  sportLabel,
} from "../../lib/format";
import type { AdminBookingsStackParamList } from "../../navigation/types";

type Rt = RouteProp<AdminBookingsStackParamList, "AdminBookingDetail">;

const PAYMENT_STATUS_COLOR: Record<string, string> = {
  PENDING: colors.yellow400,
  PARTIAL: colors.yellow400,
  COMPLETED: colors.emerald400,
  REFUNDED: "#60a5fa",
  FAILED: colors.destructive,
};

const PAYMENT_METHOD_ICONS: Record<string, typeof CreditCard> = {
  RAZORPAY: CreditCard,
  PHONEPE: Smartphone,
  UPI_QR: Banknote,
  CASH: Banknote,
  FREE: Banknote,
};

export function AdminBookingDetailScreen() {
  const { params } = useRoute<Rt>();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["admin-booking", params.bookingId],
    queryFn: () => adminBookingsApi.detail(params.bookingId),
    refetchOnWindowFocus: false,
  });

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ["admin-booking", params.bookingId] });
    void qc.invalidateQueries({ queryKey: ["admin-bookings"] });
  }

  const confirmUpi = useMutation({
    mutationFn: () => adminBookingsApi.confirmUpi(params.bookingId),
    onSuccess: () => {
      invalidate();
      Alert.alert("Confirmed", "Payment marked as verified.");
    },
    onError: (err) =>
      Alert.alert(
        "Couldn't confirm",
        err instanceof AdminApiError ? err.message : "Try again.",
      ),
  });

  const confirmCash = useMutation({
    mutationFn: () => adminBookingsApi.confirmCash(params.bookingId),
    onSuccess: () => {
      invalidate();
      Alert.alert("Confirmed", "Cash payment recorded.");
    },
    onError: (err) =>
      Alert.alert(
        "Couldn't confirm",
        err instanceof AdminApiError ? err.message : "Try again.",
      ),
  });

  const cancel = useMutation({
    mutationFn: (reason: string) =>
      adminBookingsApi.cancel(params.bookingId, reason),
    onSuccess: () => {
      invalidate();
      Alert.alert("Cancelled", "Booking cancelled. Customer notified.");
    },
    onError: (err) =>
      Alert.alert(
        "Couldn't cancel",
        err instanceof AdminApiError ? err.message : "Try again.",
      ),
  });

  const [collectModal, setCollectModal] = useState<{
    open: boolean;
    cash: string;
    upi: string;
  }>({ open: false, cash: "", upi: "" });

  const markCollected = useMutation({
    mutationFn: (vars: { cash: number; upi: number }) =>
      adminBookingsApi.markCollected(params.bookingId, vars.cash, vars.upi),
    onSuccess: () => {
      invalidate();
      setCollectModal({ open: false, cash: "", upi: "" });
      Alert.alert("Collected", "Remainder marked as collected at venue.");
    },
    onError: (err) =>
      Alert.alert(
        "Couldn't save",
        err instanceof AdminApiError ? err.message : "Try again.",
      ),
  });

  if (query.isLoading) {
    return <DetailSkeleton />;
  }

  if (query.isError || !query.data) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text variant="body" color={colors.destructive}>
            Couldn't load this booking.
          </Text>
          <Pressable
            onPress={() => void query.refetch()}
            style={[styles.actionBtn, styles.actionBtnNeutral]}
          >
            <Text variant="small" color={colors.zinc300} weight="600">
              Retry
            </Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  const booking = query.data.booking;
  const isPending = booking.status === "PENDING";
  const isConfirmed = booking.status === "CONFIRMED";
  const payment = booking.payment;

  const canConfirmUpi =
    isPending &&
    payment?.method === "UPI_QR" &&
    payment.status === "PENDING";
  const canConfirmCash =
    isPending && payment?.method === "CASH" && payment.status === "PENDING";
  const canCancel = isPending || isConfirmed;
  const venueDue =
    payment?.isPartialPayment && (payment?.remainingAmount ?? 0) > 0
      ? Math.max(booking.totalAmount - (payment?.advanceAmount ?? 0), 0)
      : 0;
  const canMarkCollected = venueDue > 0;
  const refundDue =
    payment &&
    !payment.isPartialPayment &&
    payment.status === "COMPLETED" &&
    payment.amount > booking.totalAmount
      ? payment.amount - booking.totalAmount
      : 0;

  function onCancelTap() {
    Alert.prompt(
      "Cancel booking",
      "Reason for cancellation (will appear on the audit log).",
      [
        { text: "Back", style: "cancel" },
        {
          text: "Cancel booking",
          style: "destructive",
          onPress: (reason?: string) => {
            if (!reason || !reason.trim()) {
              Alert.alert("Reason required", "Please enter a cancellation reason.");
              return;
            }
            cancel.mutate(reason.trim());
          },
        },
      ],
      "plain-text",
    );
  }

  function onMarkCollectedSubmit() {
    const cash = Math.trunc(parseFloat(collectModal.cash) || 0);
    const upi = Math.trunc(parseFloat(collectModal.upi) || 0);
    if (cash < 0 || upi < 0) {
      Alert.alert("Invalid", "Amounts cannot be negative.");
      return;
    }
    if (cash + upi !== venueDue) {
      Alert.alert(
        "Amounts don't match",
        `Cash + UPI must equal ₹${venueDue}. Currently ₹${cash + upi}.`,
      );
      return;
    }
    markCollected.mutate({ cash, upi });
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Status banner */}
        <View
          style={[
            styles.statusBanner,
            {
              borderColor: bannerBorder(booking.status),
              backgroundColor: bannerBg(booking.status),
            },
          ]}
        >
          <View
            style={[
              styles.statusDot,
              { backgroundColor: bannerDot(booking.status) },
            ]}
          />
          <Text variant="bodyStrong" color={bannerText(booking.status)}>
            {bannerLabel(booking.status)}
          </Text>
        </View>

        {/* Customer */}
        <SectionCard icon={<Phone size={14} color={colors.zinc500} />} title="Customer">
          <KV label="Name" value={booking.user.name || "—"} />
          <KV label="Phone" value={booking.user.phone || "—"} mono />
          {booking.user.email ? (
            <KV label="Email" value={booking.user.email} />
          ) : null}
          {booking.platform !== "web" ? (
            <KV
              label="Booked from"
              value={
                booking.platform === "android"
                  ? "🤖 Android app"
                  : booking.platform === "ios"
                    ? "🍎 iOS app"
                    : "🌐 Web"
              }
            />
          ) : null}
        </SectionCard>

        {/* Booking Details */}
        <SectionCard
          icon={<CalendarDays size={14} color={colors.zinc500} />}
          title="Booking Details"
        >
          <KV
            label="Sport"
            value={`${sportEmoji(booking.courtConfig.sport)} ${sportLabel(
              booking.courtConfig.sport,
            )}`}
          />
          <KV label="Court" value={booking.courtConfig.label} />
          <KV label="Date" value={formatDateLong(booking.date)} />
          <KV
            label="Slots"
            value={
              booking.slots.length
                ? formatHoursAsRanges(booking.slots.map((s) => s.startHour))
                : "—"
            }
            mono
          />
          <KV
            label="Booking ID"
            value={booking.id.slice(-8)}
            mono
            mutedValue
          />
        </SectionCard>

        {/* Payment */}
        <SectionCard
          icon={<Receipt size={14} color={colors.zinc500} />}
          title="Payment"
        >
          {payment ? (
            <>
              <KV
                label="Method"
                value={methodLabel(payment.method)}
                rightIcon={(() => {
                  const Icon = PAYMENT_METHOD_ICONS[payment.method];
                  return Icon ? <Icon size={14} color={colors.zinc400} /> : null;
                })()}
              />
              <KV
                label="Status"
                value={payment.status}
                valueColor={PAYMENT_STATUS_COLOR[payment.status] ?? colors.zinc400}
                bold
              />
              <KV label="Amount" value={formatRupees(booking.totalAmount)} bold />
              {booking.originalAmount && booking.originalAmount > booking.totalAmount ? (
                <KV
                  label="Original"
                  value={formatRupees(booking.originalAmount)}
                  mutedValue
                  strike
                />
              ) : null}

              {payment.isPartialPayment ? (
                <PartialBlock
                  advance={payment.advanceAmount ?? 0}
                  total={booking.totalAmount}
                  collected={(payment.remainingAmount ?? 0) <= 0}
                  remainderCash={payment.remainderCashAmount}
                  remainderUpi={payment.remainderUpiAmount}
                  remainderMethod={payment.remainderMethod}
                  advanceMethod={payment.method}
                  onCollect={() =>
                    setCollectModal({
                      open: true,
                      cash: String(venueDue),
                      upi: "0",
                    })
                  }
                />
              ) : null}

              {refundDue > 0 ? (
                <View style={styles.refundBlock}>
                  <View style={styles.refundHead}>
                    <Receipt size={14} color="#60a5fa" />
                    <Text variant="tiny" color="#60a5fa" style={styles.refundHeadText}>
                      BOOKING MODIFIED · REFUND DUE
                    </Text>
                  </View>
                  <KV
                    label="Captured"
                    value={formatRupees(payment.amount)}
                    smallLabel
                  />
                  <KV
                    label="New total"
                    value={formatRupees(booking.totalAmount)}
                    smallLabel
                  />
                  <KV
                    label="Refund"
                    value={formatRupees(refundDue)}
                    bold
                    valueColor="#93c5fd"
                    smallLabel
                  />
                  <Text variant="tiny" color={colors.zinc500} style={styles.refundHelp}>
                    Process via the {methodLabel(payment.method)} dashboard.
                  </Text>
                </View>
              ) : null}

              {payment.razorpayPaymentId ? (
                <KV
                  label="Razorpay ID"
                  value={payment.razorpayPaymentId}
                  mono
                  mutedValue
                />
              ) : null}
              {payment.utrNumber ? (
                <KV label="UTR" value={payment.utrNumber} mono mutedValue />
              ) : null}
            </>
          ) : (
            <Text variant="small" color={colors.zinc500}>
              No payment recorded.
            </Text>
          )}
        </SectionCard>

        {/* Admin Actions */}
        <SectionCard
          icon={<Clock size={14} color={colors.zinc500} />}
          title="Admin Actions"
        >
          <View style={styles.actions}>
            {canConfirmUpi ? (
              <ActionButton
                label="Confirm UPI Payment"
                icon={<CheckCircle2 size={16} color={colors.emerald400} />}
                tone="success"
                loading={confirmUpi.isPending}
                onPress={() =>
                  Alert.alert(
                    "Confirm UPI?",
                    "Mark this booking as paid? Customer will be notified.",
                    [
                      { text: "Back", style: "cancel" },
                      { text: "Confirm", onPress: () => confirmUpi.mutate() },
                    ],
                  )
                }
              />
            ) : null}
            {canConfirmCash ? (
              <ActionButton
                label="Confirm Cash Payment"
                icon={<CheckCircle2 size={16} color={colors.emerald400} />}
                tone="success"
                loading={confirmCash.isPending}
                onPress={() =>
                  Alert.alert(
                    "Confirm cash?",
                    "Mark this booking as paid in cash? Customer will be notified.",
                    [
                      { text: "Back", style: "cancel" },
                      { text: "Confirm", onPress: () => confirmCash.mutate() },
                    ],
                  )
                }
              />
            ) : null}
            {canMarkCollected ? (
              <ActionButton
                label={`Mark ${formatRupees(venueDue)} collected`}
                icon={<IndianRupee size={16} color={colors.yellow400} />}
                tone="warning"
                onPress={() =>
                  setCollectModal({
                    open: true,
                    cash: String(venueDue),
                    upi: "0",
                  })
                }
              />
            ) : null}
            {canCancel ? (
              <ActionButton
                label="Cancel Booking"
                icon={<XCircle size={16} color={colors.destructive} />}
                tone="danger"
                loading={cancel.isPending}
                onPress={onCancelTap}
              />
            ) : null}
            {!canConfirmUpi && !canConfirmCash && !canMarkCollected && !canCancel ? (
              <Text variant="small" color={colors.zinc600}>
                No actions available for this booking state.
              </Text>
            ) : null}
          </View>
        </SectionCard>

        {/* Mark-collected sheet (RN doesn't have a native bottom-sheet
            in core; using an inline modal-ish card for simplicity). */}
        {collectModal.open ? (
          <View style={styles.collectCard}>
            <Text variant="bodyStrong" style={styles.collectTitle}>
              Mark ₹{venueDue} collected
            </Text>
            <Text variant="small" color={colors.zinc500}>
              Split between cash and UPI QR. Either can be 0.
            </Text>
            <View style={styles.collectRow}>
              <View style={styles.collectField}>
                <Text variant="tiny" color={colors.zinc500} style={styles.collectLabel}>
                  CASH
                </Text>
                <TextInput
                  style={styles.collectInput}
                  keyboardType="numeric"
                  value={collectModal.cash}
                  onChangeText={(v) =>
                    setCollectModal((s) => ({ ...s, cash: v }))
                  }
                  placeholder="0"
                  placeholderTextColor={colors.zinc600}
                />
              </View>
              <View style={styles.collectField}>
                <Text variant="tiny" color={colors.zinc500} style={styles.collectLabel}>
                  UPI QR
                </Text>
                <TextInput
                  style={styles.collectInput}
                  keyboardType="numeric"
                  value={collectModal.upi}
                  onChangeText={(v) =>
                    setCollectModal((s) => ({ ...s, upi: v }))
                  }
                  placeholder="0"
                  placeholderTextColor={colors.zinc600}
                />
              </View>
            </View>
            <View style={styles.collectActions}>
              <Pressable
                onPress={() =>
                  setCollectModal({ open: false, cash: "", upi: "" })
                }
                style={[styles.actionBtn, styles.actionBtnNeutral]}
              >
                <Text variant="small" color={colors.zinc300} weight="600">
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={onMarkCollectedSubmit}
                disabled={markCollected.isPending}
                style={[
                  styles.actionBtn,
                  styles.actionBtnSuccess,
                  markCollected.isPending && { opacity: 0.6 },
                ]}
              >
                <Text variant="small" color={colors.emerald400} weight="600">
                  {markCollected.isPending ? "Saving…" : "Save"}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* Edit history */}
        {booking.editHistory && booking.editHistory.length > 0 ? (
          <SectionCard
            icon={<History size={14} color={colors.zinc500} />}
            title={`Audit (${booking.editHistory.length})`}
          >
            <View style={{ gap: spacing["2"] }}>
              {booking.editHistory.map((h) => (
                <View key={h.id} style={styles.auditRow}>
                  <Text variant="small" color={colors.zinc300} weight="600">
                    {h.editType.replace(/_/g, " ")}
                  </Text>
                  <Text variant="tiny" color={colors.zinc500}>
                    {h.adminUsername} ·{" "}
                    {new Date(h.createdAt).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </Text>
                  {h.note ? (
                    <Text variant="tiny" color={colors.zinc400}>
                      {h.note}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          </SectionCard>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function SectionCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        {icon}
        <Text variant="tiny" color={colors.zinc500} style={styles.cardTitle}>
          {title.toUpperCase()}
        </Text>
      </View>
      <View style={styles.cardBody}>{children}</View>
    </View>
  );
}

function KV({
  label,
  value,
  mono,
  mutedValue,
  strike,
  bold,
  valueColor,
  rightIcon,
  smallLabel,
}: {
  label: string;
  value: string;
  mono?: boolean;
  mutedValue?: boolean;
  strike?: boolean;
  bold?: boolean;
  valueColor?: string;
  rightIcon?: React.ReactNode;
  smallLabel?: boolean;
}) {
  return (
    <View style={styles.kv}>
      <Text
        variant={smallLabel ? "tiny" : "small"}
        color={colors.zinc500}
      >
        {label}
      </Text>
      <View style={styles.kvRight}>
        {rightIcon}
        <Text
          variant={bold ? "bodyStrong" : smallLabel ? "tiny" : "small"}
          color={valueColor ?? (mutedValue ? colors.zinc500 : colors.foreground)}
          style={[
            mono && { fontFamily: "Courier" },
            strike && { textDecorationLine: "line-through" },
          ]}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

function PartialBlock({
  advance,
  total,
  collected,
  remainderCash,
  remainderUpi,
  remainderMethod,
  advanceMethod,
  onCollect,
}: {
  advance: number;
  total: number;
  collected: boolean;
  remainderCash: number | null;
  remainderUpi: number | null;
  remainderMethod: string | null;
  advanceMethod: string;
  onCollect: () => void;
}) {
  const venueTotal = Math.max(total - advance, 0);
  const remaining = collected ? 0 : venueTotal;
  const percentPaid = total > 0 ? Math.round((advance / total) * 100) : 0;
  const cash = remainderCash ?? (remainderMethod === "CASH" ? venueTotal : 0);
  const upi = remainderUpi ?? (remainderMethod === "UPI_QR" ? venueTotal : 0);
  const isSplit = (cash ?? 0) > 0 && (upi ?? 0) > 0;
  const remainderLabel = collected
    ? isSplit
      ? `${formatRupees(cash)} Cash + ${formatRupees(upi)} UPI`
      : (cash ?? 0) > 0
        ? "Cash"
        : (upi ?? 0) > 0
          ? "UPI QR"
          : remainderMethod
            ? methodLabel(remainderMethod)
            : null
    : null;

  return (
    <View
      style={[
        styles.partialBlock,
        {
          borderColor: collected
            ? "rgba(34, 197, 94, 0.30)"
            : "rgba(245, 158, 11, 0.40)",
          backgroundColor: collected
            ? "rgba(34, 197, 94, 0.10)"
            : "rgba(245, 158, 11, 0.10)",
        },
      ]}
    >
      <View style={styles.partialHead}>
        {collected ? (
          <CheckCircle2 size={14} color={colors.emerald400} />
        ) : (
          <Banknote size={14} color={colors.yellow400} />
        )}
        <Text
          variant="tiny"
          color={collected ? colors.emerald400 : colors.yellow400}
          style={styles.partialHeadText}
        >
          {collected
            ? `PAID IN FULL · ${percentPaid}% WAS ADVANCE`
            : `${percentPaid}% ADVANCE BOOKING`}
        </Text>
      </View>
      <View style={styles.kv}>
        <Text variant="tiny" color={colors.zinc400}>
          Advance paid · {methodLabel(advanceMethod)}
        </Text>
        <Text variant="small" color={colors.emerald400} weight="600">
          {formatRupees(advance)}
        </Text>
      </View>
      <View style={styles.kv}>
        <Text
          variant="tiny"
          color={collected ? "#a7f3d0" : "#fcd34d"}
        >
          {collected
            ? `Collected at venue${remainderLabel ? ` · ${remainderLabel}` : ""}`
            : "Collect at venue"}
        </Text>
        <Text
          variant="bodyStrong"
          color={collected ? "#86efac" : "#fde68a"}
        >
          {formatRupees(collected ? venueTotal : remaining)}
        </Text>
      </View>
      {!collected ? (
        <Pressable onPress={onCollect} style={styles.partialCta}>
          <Banknote size={14} color={colors.yellow400} />
          <Text variant="small" color={colors.yellow400} weight="600">
            Mark {formatRupees(remaining)} collected
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ActionButton({
  label,
  icon,
  tone,
  onPress,
  loading,
}: {
  label: string;
  icon: React.ReactNode;
  tone: "success" | "warning" | "danger" | "neutral";
  onPress: () => void;
  loading?: boolean;
}) {
  const palette = {
    success: { border: "rgba(34, 197, 94, 0.30)", bg: "rgba(34, 197, 94, 0.10)" },
    warning: { border: "rgba(245, 158, 11, 0.40)", bg: "rgba(245, 158, 11, 0.10)" },
    danger: { border: "rgba(239, 68, 68, 0.30)", bg: "rgba(239, 68, 68, 0.10)" },
    neutral: { border: colors.zinc800, bg: colors.zinc900 },
  }[tone];
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [
        styles.actionBtn,
        { borderColor: palette.border, backgroundColor: palette.bg },
        (pressed || loading) && { opacity: 0.7 },
      ]}
    >
      {icon}
      <Text variant="small" color={colors.foreground} weight="600">
        {loading ? "…" : label}
      </Text>
    </Pressable>
  );
}

function DetailSkeleton() {
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Skeleton width="40%" height={28} rounded="full" />
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.card}>
            <Skeleton width="30%" height={11} />
            <View style={{ gap: spacing["2"], marginTop: spacing["2"] }}>
              {[0, 1, 2].map((j) => (
                <View key={j} style={styles.kv}>
                  <Skeleton width={70} height={11} />
                  <Skeleton width={120} height={12} />
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function methodLabel(m: string): string {
  return m === "UPI_QR" ? "UPI QR" : m.charAt(0) + m.slice(1).toLowerCase();
}

function sportEmoji(s: string): string {
  return s === "CRICKET" ? "🏏" : s === "FOOTBALL" ? "⚽" : "🏓";
}

function bannerLabel(s: string): string {
  return s === "CONFIRMED" ? "Confirmed" : s === "PENDING" ? "Pending" : "Cancelled";
}

function bannerDot(s: string): string {
  return s === "CONFIRMED"
    ? colors.emerald400
    : s === "PENDING"
      ? colors.yellow400
      : colors.destructive;
}

function bannerText(s: string): string {
  return bannerDot(s);
}

function bannerBorder(s: string): string {
  return s === "CONFIRMED"
    ? "rgba(34, 197, 94, 0.30)"
    : s === "PENDING"
      ? "rgba(245, 158, 11, 0.40)"
      : "rgba(239, 68, 68, 0.30)";
}

function bannerBg(s: string): string {
  return s === "CONFIRMED"
    ? "rgba(34, 197, 94, 0.10)"
    : s === "PENDING"
      ? "rgba(245, 158, 11, 0.10)"
      : "rgba(239, 68, 68, 0.10)";
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["3"],
    padding: spacing["6"],
  },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    paddingHorizontal: spacing["4"],
    paddingVertical: spacing["2.5"],
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
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
  cardBody: { gap: spacing["2"] },
  kv: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  kvRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
  },

  partialBlock: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing["3"],
    gap: spacing["1.5"],
    marginTop: spacing["1"],
  },
  partialHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
  },
  partialHeadText: { letterSpacing: 1, fontWeight: "700" },
  partialCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["1.5"],
    paddingVertical: spacing["2.5"],
    marginTop: spacing["1"],
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.40)",
    backgroundColor: "rgba(245, 158, 11, 0.05)",
  },

  refundBlock: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(96, 165, 250, 0.30)",
    backgroundColor: "rgba(96, 165, 250, 0.10)",
    padding: spacing["3"],
    gap: spacing["1.5"],
    marginTop: spacing["1"],
  },
  refundHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
  },
  refundHeadText: { letterSpacing: 1, fontWeight: "700" },
  refundHelp: { marginTop: spacing["1"] },

  actions: { gap: spacing["2"] },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["2"],
    paddingHorizontal: spacing["4"],
    paddingVertical: spacing["3"],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  actionBtnNeutral: {
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  actionBtnSuccess: {
    borderColor: "rgba(34, 197, 94, 0.30)",
    backgroundColor: "rgba(34, 197, 94, 0.10)",
  },

  collectCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.40)",
    backgroundColor: "rgba(245, 158, 11, 0.06)",
    padding: spacing["4"],
    gap: spacing["3"],
  },
  collectTitle: { color: colors.yellow400 },
  collectRow: {
    flexDirection: "row",
    gap: spacing["3"],
  },
  collectField: { flex: 1, gap: spacing["1.5"] },
  collectLabel: { letterSpacing: 1, fontWeight: "700" },
  collectInput: {
    borderWidth: 1,
    borderColor: colors.zinc700,
    borderRadius: 8,
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2.5"],
    color: colors.foreground,
    backgroundColor: colors.background,
    fontSize: 14,
  },
  collectActions: {
    flexDirection: "row",
    gap: spacing["2"],
  },

  auditRow: {
    paddingVertical: spacing["2"],
    borderRadius: radius.sm,
    backgroundColor: colors.background,
    paddingHorizontal: spacing["3"],
    gap: 2,
  },
});
