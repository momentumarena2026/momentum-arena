import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Search } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { colors, radius, spacing } from "../../theme";
import { formatRupees } from "../../lib/format";
import {
  adminRecoveryApi,
  type RecoverRazorpayResult,
} from "../../lib/admin-recovery";
import { AdminApiError } from "../../lib/admin-api";

/**
 * Mirrors web /admin/bookings/recovery. Paste a Razorpay `pay_…` id →
 * the server fetches the captured payment, finds the matching SlotHold,
 * and reconstructs the booking. Result is one of: created /
 * already-linked (green), no-hold (amber — admin uses manual create),
 * or an error (red).
 */
export function AdminRecoveryScreen() {
  const [paymentId, setPaymentId] = useState("");

  const recover = useMutation({
    mutationFn: () => adminRecoveryApi.recover(paymentId.trim()),
  });

  const result: RecoverRazorpayResult | null =
    recover.data ??
    (recover.error
      ? {
          success: false,
          error:
            recover.error instanceof AdminApiError ||
            recover.error instanceof Error
              ? recover.error.message
              : "Unknown error",
        }
      : null);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.intro}>
          <Text variant="bodyStrong">Razorpay payment recovery</Text>
          <Text variant="small" color={colors.zinc500}>
            Reconstruct a booking when the customer&apos;s payment captured
            but no booking row exists. Grab the{" "}
            <Text variant="small" color={colors.emerald400}>
              pay_…
            </Text>{" "}
            id from the Razorpay dashboard&apos;s Payments tab.
          </Text>
        </View>

        <Card style={styles.formCard}>
          <Input
            label="Razorpay payment ID"
            placeholder="pay_XYZabc123"
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            value={paymentId}
            onChangeText={setPaymentId}
          />
          <Button
            label="Recover"
            onPress={() => recover.mutate()}
            loading={recover.isPending}
            disabled={!paymentId.trim()}
            fullWidth
            size="lg"
            leadingIcon={<Search size={16} color={colors.primaryForeground} />}
          />
        </Card>

        {result ? <ResultCard result={result} /> : null}
      </ScrollView>
    </Screen>
  );
}

function ResultCard({ result }: { result: RecoverRazorpayResult }) {
  // 1. Hard error
  if (!result.success) {
    return (
      <View style={[styles.resultCard, styles.errorCard]}>
        <View style={styles.resultHead}>
          <AlertCircle size={18} color={colors.destructive} />
          <Text variant="bodyStrong" color={colors.destructive_300}>
            Recovery failed
          </Text>
        </View>
        <Text variant="small" color={colors.destructive_300}>
          {result.error}
        </Text>
        {result.payment ? <PaymentMeta p={result.payment} /> : null}
      </View>
    );
  }

  // 2. Created / already-linked — green
  if (result.state === "created" || result.state === "already-linked") {
    return (
      <View style={[styles.resultCard, styles.successCard]}>
        <View style={styles.resultHead}>
          <CheckCircle2 size={18} color={colors.emerald400} />
          <Text variant="bodyStrong" color={colors.emerald400}>
            {result.state === "created"
              ? "Booking created from payment"
              : "Booking already linked"}
          </Text>
        </View>
        {result.bookingId ? (
          <Text variant="small" color={colors.zinc300}>
            Booking id:{" "}
            <Text variant="small" color={colors.emerald400} style={styles.mono}>
              {result.bookingId}
            </Text>
          </Text>
        ) : null}
        {result.payment ? <PaymentMeta p={result.payment} /> : null}
      </View>
    );
  }

  // 3. No matching hold — amber
  return (
    <View style={[styles.resultCard, styles.warnCard]}>
      <View style={styles.resultHead}>
        <AlertCircle size={18} color={colors.yellow400} />
        <Text variant="bodyStrong" color={colors.yellow400}>
          No matching slot hold
        </Text>
      </View>
      <Text variant="small" color={colors.zinc300}>
        Payment is captured, but no slot hold matches this order — likely
        swept by the cleanup cron. Use the regular &quot;New booking&quot;
        flow, then mark it paid with the Razorpay reference below.
      </Text>
      {result.payment ? <PaymentMeta p={result.payment} /> : null}
    </View>
  );
}

function PaymentMeta({
  p,
}: {
  p: NonNullable<RecoverRazorpayResult["payment"]>;
}) {
  const capturedAt = new Date(p.createdAt * 1000).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return (
    <View style={styles.metaBox}>
      <MetaRow label="Payment ID" value={p.id} mono />
      <MetaRow label="Order ID" value={p.orderId} mono />
      <MetaRow label="Amount" value={formatRupees(p.amountRupees)} />
      <MetaRow
        label="Status"
        value={`${p.status}${p.captured ? " · captured" : ""}`}
      />
      {p.contact ? <MetaRow label="Contact" value={p.contact} /> : null}
      {p.email ? <MetaRow label="Email" value={p.email} /> : null}
      <MetaRow label="Captured at" value={capturedAt} />
    </View>
  );
}

function MetaRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={styles.metaRow}>
      <Text variant="tiny" color={colors.zinc500}>
        {label}
      </Text>
      <Text
        variant="tiny"
        color={colors.zinc300}
        style={mono ? styles.mono : undefined}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["10"],
    gap: spacing["4"],
  },
  intro: { gap: spacing["1"] },
  formCard: { padding: spacing["4"], gap: spacing["3"] },
  resultCard: {
    padding: spacing["4"],
    borderRadius: radius.xl,
    borderWidth: 1,
    gap: spacing["3"],
  },
  errorCard: {
    borderColor: colors.destructive_30,
    backgroundColor: colors.destructive_10,
  },
  successCard: {
    borderColor: colors.emerald400_50,
    backgroundColor: colors.emerald500_10,
  },
  warnCard: {
    borderColor: "rgba(250, 204, 21, 0.40)",
    backgroundColor: "rgba(250, 204, 21, 0.10)",
  },
  resultHead: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  metaBox: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["3"],
    gap: spacing["1.5"],
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing["3"],
  },
  mono: { fontFamily: "Courier" },
});
