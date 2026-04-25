import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import {
  Calendar,
  CheckCircle2,
  Clock,
  MapPin,
  QrCode,
  Receipt,
  XCircle,
} from "lucide-react-native";
import QRCode from "react-native-qrcode-svg";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { colors, radius, spacing } from "../../theme";
import { bookingsApi } from "../../lib/bookings";
import {
  formatDateLong,
  formatHoursAsRanges,
  formatRupees,
  sportLabel,
} from "../../lib/format";
import type {
  BookingStatus,
  PaymentMethod,
  PaymentStatus,
} from "../../lib/types";
import type {
  AccountStackParamList,
  MainTabsParamList,
} from "../../navigation/types";

type Rt = RouteProp<AccountStackParamList, "BookingDetail">;
type Nav = NativeStackNavigationProp<AccountStackParamList, "BookingDetail">;

// ──────────────────────────────────────────────────────────────────────────────
// Status header config — mirrors web's `statusConfig` in
// app/book/confirmation/page.tsx.
// ──────────────────────────────────────────────────────────────────────────────
interface StatusConfig {
  Icon: typeof CheckCircle2;
  /** Tailwind `text-*-400` — also used for the status header title accent. */
  iconColor: string;
  /** Tailwind `bg-*-500/10` */
  bg: string;
  /** Tailwind `border-*-500/30` */
  border: string;
  title: string;
  subtitle: string;
}

function getStatusConfig(
  status: BookingStatus,
  isAwaitingVerification: boolean,
  refundReason: string | null
): StatusConfig {
  switch (status) {
    case "CONFIRMED":
      return {
        Icon: CheckCircle2,
        iconColor: colors.emerald400, // text-emerald-400
        bg: "rgba(16, 185, 129, 0.10)", // bg-emerald-500/10
        border: "rgba(16, 185, 129, 0.30)", // border-emerald-500/30
        title: "Booking Confirmed!",
        subtitle: "Your court has been reserved successfully.",
      };
    case "PENDING":
      return {
        Icon: Clock,
        iconColor: "#facc15", // text-yellow-400
        bg: "rgba(234, 179, 8, 0.10)", // bg-yellow-500/10
        border: "rgba(234, 179, 8, 0.30)", // border-yellow-500/30
        title: isAwaitingVerification
          ? "Payment Verification Pending"
          : "Awaiting Payment",
        subtitle: isAwaitingVerification
          ? "Your slot is reserved. Once our team verifies your payment, the booking will be confirmed."
          : "Complete payment to confirm your booking.",
      };
    case "CANCELLED":
      return {
        Icon: XCircle,
        iconColor: "#f87171", // text-red-400
        bg: "rgba(239, 68, 68, 0.10)", // bg-red-500/10
        border: "rgba(239, 68, 68, 0.30)", // border-red-500/30
        title: "Booking Cancelled",
        subtitle: refundReason
          ? `Reason: ${refundReason}`
          : "This booking has been cancelled.",
      };
  }
}

// Mirror of web's `paymentLabel` map.
const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  RAZORPAY: "Online (Razorpay)",
  PHONEPE: "Online (PhonePe)",
  UPI_QR: "UPI QR",
  CASH: "Cash at Venue",
  FREE: "Complimentary",
};

// Mirror of web's `paymentStatusLabel` map.
const PAYMENT_STATUS_LABEL: Record<PaymentStatus, { text: string; color: string }> = {
  PENDING: { text: "Pending", color: "#facc15" }, // text-yellow-400
  PARTIAL: { text: "Advance Paid", color: "#fcd34d" }, // text-amber-300
  COMPLETED: { text: "Paid", color: colors.emerald400 }, // text-emerald-400
  REFUNDED: { text: "Refunded", color: "#60a5fa" }, // text-blue-400
  FAILED: { text: "Failed", color: "#f87171" }, // text-red-400
};

export function BookingDetailScreen() {
  const { params } = useRoute<Rt>();
  const navigation = useNavigation<Nav>();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["booking", params.bookingId],
    queryFn: () => bookingsApi.detail(params.bookingId),
  });

  if (isLoading) {
    return (
      <Screen>
        <View style={styles.loader}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (isError || !data) {
    return (
      <Screen>
        <Card>
          <Text variant="bodyStrong">Couldn't load this booking</Text>
          <Text variant="small" color={colors.mutedForeground}>
            It may have been cancelled or moved. Try again in a moment.
          </Text>
        </Card>
      </Screen>
    );
  }

  const payment = data.payment;
  const timeRange = formatHoursAsRanges(data.slots.map((s) => s.startHour));
  const courtLabel = data.wasBookedAsHalfCourt
    ? "Half Court (40×90)"
    : data.courtConfig.label;
  const sportName = sportLabel(data.courtConfig.sport);

  // Mirror of web's isAwaitingVerification flag.
  const isAwaitingVerification =
    data.status === "PENDING" &&
    payment?.status === "PENDING" &&
    (payment?.method === "UPI_QR" || payment?.method === "CASH");

  const statusCfg = getStatusConfig(data.status, isAwaitingVerification, null);
  const { Icon: StatusIcon } = statusCfg;

  const hasDiscount =
    data.originalAmount != null && data.discountAmount > 0;
  const paymentStatusMeta = payment
    ? PAYMENT_STATUS_LABEL[payment.status]
    : null;

  // ── Actions ───────────────────────────────────────────────────────────────
  function goToBookings() {
    navigation.navigate("BookingsList");
  }

  function goToBook() {
    // Cross-tab: AccountStack → MainTabs → Sports.
    navigation
      .getParent<NativeStackNavigationProp<MainTabsParamList>>()
      ?.navigate("Sports", { screen: "BookSport" });
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Status Header ─────────────────────────────────────────────
            Web: <div className="rounded-2xl border p-6 text-center {status.bg}">
                   <StatusIcon className="mx-auto h-12 w-12 {status.color}" />
                   <h1 className="mt-3 text-xl font-bold text-white">{title}</h1>
                   <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>
                 </div> */}
        <View
          style={[
            styles.statusHeader,
            { backgroundColor: statusCfg.bg, borderColor: statusCfg.border },
          ]}
        >
          <StatusIcon size={48} color={statusCfg.iconColor} />
          <Text
            variant="heading"
            weight="700"
            color={colors.foreground}
            align="center"
            style={styles.statusTitle}
          >
            {statusCfg.title}
          </Text>
          <Text
            variant="small"
            color={colors.zinc400}
            align="center"
            style={styles.statusSubtitle}
          >
            {statusCfg.subtitle}
          </Text>
        </View>

        {/* ─── Booking Details card ──────────────────────────────────────
            Web: <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4"> */}
        <View style={styles.detailsCard}>
          {/* Booking ID row */}
          <View style={styles.bookingIdRow}>
            <Text variant="tiny" color={colors.zinc500}>
              Booking ID
            </Text>
            <Text variant="tiny" color={colors.zinc500} style={styles.monoId}>
              {data.id}
            </Text>
          </View>

          <View style={styles.detailsList}>
            {/* Calendar + date */}
            <DetailRow Icon={Calendar}>
              <Text variant="bodyStrong" color={colors.foreground}>
                {formatDateLong(data.date)}
              </Text>
              <Text variant="small" color={colors.zinc400}>
                {timeRange}
              </Text>
            </DetailRow>

            {/* MapPin + sport */}
            <DetailRow Icon={MapPin}>
              <Text variant="bodyStrong" color={colors.foreground}>
                {sportName}
              </Text>
              <Text variant="small" color={colors.zinc400}>
                {courtLabel}
              </Text>
            </DetailRow>

            {/* Receipt + pricing */}
            <DetailRow Icon={Receipt}>
              {hasDiscount ? (
                <View style={styles.miniRow}>
                  <Text variant="tiny" color={colors.zinc500}>
                    Original
                  </Text>
                  <Text
                    variant="tiny"
                    color={colors.zinc500}
                    style={styles.strike}
                  >
                    {formatRupees(data.originalAmount!)}
                  </Text>
                </View>
              ) : null}
              {data.discountAmount > 0 ? (
                <View style={styles.miniRow}>
                  <Text variant="tiny" color={colors.emerald400}>
                    Discount applied
                  </Text>
                  <Text variant="tiny" color={colors.emerald400}>
                    −{formatRupees(data.discountAmount)}
                  </Text>
                </View>
              ) : null}

              <View style={styles.totalRow}>
                <Text variant="bodyStrong" color={colors.foreground}>
                  {formatRupees(data.totalAmount)}
                </Text>
                {paymentStatusMeta ? (
                  <Text
                    variant="tiny"
                    weight="600"
                    style={{ color: paymentStatusMeta.color }}
                  >
                    {paymentStatusMeta.text}
                  </Text>
                ) : null}
              </View>

              {payment?.isPartialPayment && payment.advanceAmount != null ? (
                <View style={styles.miniRowGroup}>
                  <View style={styles.miniRow}>
                    <Text variant="tiny" color={colors.emerald400}>
                      Advance Paid
                    </Text>
                    <Text variant="tiny" color={colors.emerald400}>
                      {formatRupees(payment.advanceAmount)}
                    </Text>
                  </View>
                  <View style={styles.miniRow}>
                    <Text variant="tiny" color="#facc15">
                      Due at Venue
                    </Text>
                    <Text variant="tiny" color="#facc15">
                      {formatRupees(payment.remainingAmount ?? 0)}
                    </Text>
                  </View>
                </View>
              ) : null}

              {payment ? (
                <Text variant="tiny" color={colors.zinc400} style={styles.viaLine}>
                  via {PAYMENT_LABEL[payment.method]}
                </Text>
              ) : null}
            </DetailRow>
          </View>
        </View>

        {/* ─── QR Check-in ────────────────────────────────────────────────
            Only shown for CONFIRMED bookings with a qrToken. Web has its own
            BookingQR component with the same visual treatment. */}
        {data.qrToken && data.status === "CONFIRMED" ? (
          <View style={styles.detailsCard}>
            <View style={styles.qrHeader}>
              <QrCode size={18} color={colors.emerald400} />
              <Text variant="bodyStrong">Check in</Text>
            </View>
            <Text variant="small" color={colors.zinc400}>
              Show this at the front desk to check in.
            </Text>
            <View style={styles.qrWrap}>
              <View style={styles.qrFrame}>
                <QRCode
                  value={data.qrToken}
                  size={200}
                  color="#000000"
                  backgroundColor="#ffffff"
                  ecl="M"
                />
              </View>
              <Text
                variant="tiny"
                color={colors.subtleForeground}
                style={styles.qrCaption}
                selectable
              >
                {data.qrToken.slice(0, 18).toUpperCase()}
              </Text>
            </View>
          </View>
        ) : null}

        {/* ─── Actions ────────────────────────────────────────────────────
            Web: <div className="flex gap-3">
                   <Link className="flex-1 rounded-xl border border-zinc-700 ...">My Bookings</Link>
                   <Link className="flex-1 rounded-xl bg-emerald-600 ...">Book Another</Link>
                 </div> */}
        <View style={styles.actionsRow}>
          <Pressable
            onPress={goToBookings}
            style={({ pressed }) => [
              styles.actionBtn,
              styles.actionBtnSecondary,
              pressed && styles.pressed,
            ]}
          >
            <Text variant="small" weight="600" color={colors.zinc300}>
              My Bookings
            </Text>
          </Pressable>
          <Pressable
            onPress={goToBook}
            style={({ pressed }) => [
              styles.actionBtn,
              styles.actionBtnPrimary,
              pressed && styles.pressed,
            ]}
          >
            <Text variant="small" weight="600" color="#ffffff">
              Book Another
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Internals
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Mirrors the web layout for each row inside the booking-details card:
 *
 *   <div className="flex items-center gap-3">
 *     <div className="rounded-lg bg-zinc-800 p-2">
 *       <Icon className="h-4 w-4 text-zinc-400" />
 *     </div>
 *     <div>…</div>
 *   </div>
 */
function DetailRow({
  Icon,
  children,
}: {
  Icon: typeof Calendar;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailIconBox}>
        <Icon size={16} color={colors.zinc400} />
      </View>
      <View style={styles.detailContent}>{children}</View>
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["8"],
    // Web uses `space-y-6` between top-level blocks inside `max-w-lg`.
    gap: spacing["6"],
  },
  loader: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  // Status header — web: rounded-2xl border p-6 text-center
  statusHeader: {
    borderRadius: 16, // rounded-2xl
    borderWidth: 1,
    padding: spacing["6"], // p-6
    alignItems: "center",
  },
  // Web: mt-3 text-xl font-bold text-white
  statusTitle: {
    marginTop: spacing["3"],
    fontSize: 20,
    lineHeight: 26,
  },
  // Web: mt-1 text-sm text-zinc-400
  statusSubtitle: {
    marginTop: spacing["1"],
  },

  // Details card — web: rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4
  detailsCard: {
    borderRadius: 12, // rounded-xl
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["5"], // p-5
    gap: spacing["4"], // space-y-4
  },
  // Web: flex items-center justify-between text-xs text-zinc-500
  bookingIdRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  monoId: {
    // Web: `font-mono` — use platform mono so it lines up with web visually.
    fontFamily: undefined, // Menlo / monospace inherited via global config; keep tiny for length
  },
  // Web: space-y-3 inside the details block
  detailsList: {
    gap: spacing["3"],
  },
  // Web: flex items-center gap-3
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
  },
  // Web: rounded-lg bg-zinc-800 p-2
  detailIconBox: {
    borderRadius: 8,
    backgroundColor: colors.zinc800,
    padding: spacing["2"],
    alignItems: "center",
    justifyContent: "center",
  },
  detailContent: {
    flex: 1,
    gap: 2,
  },
  // Mini rows inside the Receipt block (original/discount etc.) — web uses
  // flex justify-between with text-xs.
  miniRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  miniRowGroup: {
    gap: 2,
  },
  strike: {
    textDecorationLine: "line-through",
  },
  // Total row aligns with payment-status pill (web: items-center justify-between).
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 2,
  },
  viaLine: {
    marginTop: 2,
  },

  // QR card
  qrHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  qrWrap: {
    alignItems: "center",
    gap: spacing["2"],
    marginTop: spacing["2"],
  },
  qrFrame: {
    padding: spacing["3"],
    borderRadius: 14,
    backgroundColor: "#ffffff",
  },
  qrCaption: {
    letterSpacing: 2,
  },

  // Actions row — web: flex gap-3, each button `flex-1`
  actionsRow: {
    flexDirection: "row",
    gap: spacing["3"],
  },
  actionBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12, // rounded-xl
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing["4"],
  },
  // Web: border border-zinc-700 text-zinc-300 (no background)
  actionBtnSecondary: {
    borderWidth: 1,
    borderColor: "#3f3f46", // zinc-700
    backgroundColor: "transparent",
  },
  // Web: bg-emerald-600 text-white
  actionBtnPrimary: {
    backgroundColor: "#059669", // emerald-600
  },
  pressed: {
    opacity: 0.85,
  },
});
