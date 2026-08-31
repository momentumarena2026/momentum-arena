import { ScrollView, StyleSheet, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  CalendarDays,
  Clock,
  IndianRupee,
  Ticket,
  Users,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { adminPassesApi, type AdminPassDetail } from "../../lib/admin-passes";
import { colors, radius } from "../../theme";
import type { AdminMoreStackParamList } from "../../navigation/types";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
/** Hours, trimmed: 90 min reads "1.5h", 120 reads "2h". */
const hrs = (m: number) => `${(m / 60).toFixed(1).replace(/\.0$/, "")}h`;

const day = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const dayTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: colors.emerald400,
  UPCOMING: colors.yellow400,
  CANCELLED: colors.destructive,
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text variant="tiny" color={colors.zinc500}>
        {label}
      </Text>
      <Text variant="small" color={colors.zinc300} style={styles.rowValue}>
        {value}
      </Text>
    </View>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <View style={styles.stat}>
      <View style={styles.statHead}>
        <Icon size={12} color={colors.zinc500} />
        <Text variant="tiny" color={colors.zinc500}>
          {label}
        </Text>
      </View>
      <Text variant="title" color={colors.foreground}>
        {value}
      </Text>
      {sub ? (
        <Text variant="tiny" color={colors.zinc500}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Admin view of one sold pass — the app's twin of /admin/passes/[id].
 *
 * Read-only by design. Extend / Adjust / Cancel already live on the passes
 * list and mutate through their own gated endpoints; duplicating them here
 * would mean two places to keep correct on a money path. This screen answers
 * "what happened to this pass" — when it was bought, how it was paid for,
 * what has been consumed and every booking that drew on it.
 */
export function AdminPassDetailScreen() {
  const route = useRoute<RouteProp<AdminMoreStackParamList, "AdminPassDetail">>();
  const { passId } = route.params;

  const query = useQuery<AdminPassDetail>({
    queryKey: ["admin-pass-detail", passId],
    queryFn: () => adminPassesApi.detail(passId),
  });

  if (query.isLoading) {
    return (
      <Screen>
        <View style={styles.loading}>
          <Skeleton height={72} rounded="xl" />
          <Skeleton height={120} rounded="xl" />
          <Skeleton height={180} rounded="xl" />
        </View>
      </Screen>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Screen>
        <View style={styles.loading}>
          <Text variant="body" color={colors.destructive}>
            Couldn&apos;t load this pass.
          </Text>
          <Text variant="tiny" color={colors.zinc500}>
            {query.error instanceof Error ? query.error.message : "Unknown error"}
          </Text>
        </View>
      </Screen>
    );
  }

  const p = query.data;
  const consumedPct =
    p.totalMinutes > 0
      ? Math.min(100, Math.round((p.consumedMinutes / p.totalMinutes) * 100))
      : 0;
  // Returned redemptions stay in the list, dimmed — a gap in the history is
  // worse than a struck-through row.
  const live = p.bookings.filter((b) => !b.restored);
  const ordered = [...live, ...p.bookings.filter((b) => b.restored)];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View>
          <View style={styles.titleRow}>
            <Text variant="title" color={colors.foreground}>
              {p.name}
            </Text>
            <Text
              variant="tiny"
              color={STATUS_COLOR[p.status] ?? colors.zinc400}
              style={styles.status}
            >
              {p.status}
            </Text>
          </View>
          <Text variant="tiny" color={colors.zinc500}>
            {p.owner.name ?? "—"} · {p.owner.phone ?? "—"}
          </Text>
          <Text variant="tiny" color={colors.zinc500}>
            {p.sport} · {p.courtLabel}
            {p.bandsSummary ? ` · ${p.bandsSummary}` : ""}
          </Text>
        </View>

        {/* The four numbers worth opening this screen for */}
        <View style={styles.statGrid}>
          <Stat
            icon={Clock}
            label="Remaining"
            value={hrs(p.remainingMinutes)}
            sub={`of ${hrs(p.totalMinutes)}`}
          />
          <Stat
            icon={Ticket}
            label="Consumed"
            value={hrs(p.consumedMinutes)}
            sub={`${consumedPct}% · ${live.length} booking${live.length === 1 ? "" : "s"}`}
          />
          <Stat icon={IndianRupee} label="Paid" value={inr(p.price)} sub={p.methodLabel} />
          <Stat
            icon={CalendarClock}
            label="Expires"
            value={day(p.expiresAt)}
            sub={`${p.validityDays} days`}
          />
        </View>

        {/* Consumption bar — fastest read of how much is left */}
        <View style={styles.card}>
          <View style={styles.barLabels}>
            <Text variant="tiny" color={colors.zinc500}>
              {hrs(p.consumedMinutes)} used
            </Text>
            <Text variant="tiny" color={colors.zinc500}>
              {hrs(p.remainingMinutes)} left
            </Text>
          </View>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${consumedPct}%` }]} />
          </View>
        </View>

        {/* Timeline */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <CalendarDays size={14} color={colors.zinc500} />
            <Text variant="bodyStrong" color={colors.foreground}>
              Timeline
            </Text>
          </View>
          <Row label="Purchased" value={dayTime(p.purchasedAt)} />
          <Row label="Starts" value={day(p.startsAt)} />
          <Row label="Expires" value={day(p.expiresAt)} />
        </View>

        {/* Payment trail */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <IndianRupee size={14} color={colors.zinc500} />
            <Text variant="bodyStrong" color={colors.foreground}>
              Payment
            </Text>
          </View>
          <Row label="Method" value={p.methodLabel} />
          <Row label="Amount" value={inr(p.price)} />
          {p.issuedByUsername ? (
            <Row label="Issued by" value={p.issuedByUsername} />
          ) : null}
          {p.admin.razorpayPaymentId ? (
            <Row label="Razorpay" value={p.admin.razorpayPaymentId} />
          ) : null}
          {p.admin.phonePeMerchantTxnId ? (
            <Row label="PhonePe txn" value={p.admin.phonePeMerchantTxnId} />
          ) : null}
          {p.admin.offlineRef ? (
            <Row label="Reference" value={p.admin.offlineRef} />
          ) : null}
        </View>

        {/* Shared members */}
        {p.members.length > 0 ? (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Users size={14} color={colors.zinc500} />
              <Text variant="bodyStrong" color={colors.foreground}>
                Shared with {p.members.length} of {p.maxMembers}
              </Text>
            </View>
            {p.members.map((m) => (
              <Row
                key={m.userId}
                label={m.name ?? "—"}
                value={m.phone ?? "—"}
              />
            ))}
          </View>
        ) : null}

        {/* Redemption history */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Ticket size={14} color={colors.zinc500} />
            <Text variant="bodyStrong" color={colors.foreground}>
              Bookings on this pass
            </Text>
          </View>

          {ordered.length === 0 ? (
            <Text variant="tiny" color={colors.zinc500}>
              No bookings have used this pass yet.
            </Text>
          ) : (
            ordered.map((b) => (
              <View
                key={b.bookingId}
                style={[styles.booking, b.restored && styles.bookingRestored]}
              >
                <View style={styles.bookingMain}>
                  <Text variant="small" color={colors.zinc300}>
                    {day(b.date)} · {b.timeLabel}
                  </Text>
                  <Text variant="tiny" color={colors.zinc500}>
                    {b.bookedBy ?? "—"} ·{" "}
                    {b.restored ? "hours returned" : b.bookingStatus}
                  </Text>
                </View>
                <View style={styles.bookingRight}>
                  <Text variant="small" color={colors.foreground}>
                    {hrs(b.minutes)}
                  </Text>
                  <Text variant="tiny" color={colors.zinc500}>
                    {inr(b.value)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 12, paddingBottom: 40 },
  loading: { gap: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  status: { letterSpacing: 1, fontWeight: "700" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: {
    flexGrow: 1,
    flexBasis: "47%",
    backgroundColor: colors.zinc900,
    borderRadius: radius.lg,
    padding: 12,
    gap: 2,
  },
  statHead: { flexDirection: "row", alignItems: "center", gap: 4 },
  card: {
    backgroundColor: colors.zinc900,
    borderRadius: radius.lg,
    padding: 14,
    gap: 8,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowValue: { flexShrink: 1, textAlign: "right" },
  barLabels: { flexDirection: "row", justifyContent: "space-between" },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.zinc800,
    overflow: "hidden",
  },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.emerald500 },
  booking: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.zinc800,
  },
  bookingRestored: { opacity: 0.5 },
  bookingMain: { flexShrink: 1, gap: 2 },
  bookingRight: { alignItems: "flex-end", gap: 2 },
});
