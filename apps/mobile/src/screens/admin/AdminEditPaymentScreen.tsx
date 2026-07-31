import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, XCircle } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminBookingsApi,
  AdminApiError,
  type AdminPaymentMethod,
  type AdminPaymentStatus,
} from "../../lib/admin-bookings";
import type { AdminBookingsStackParamList } from "../../navigation/types";

type Rt = RouteProp<AdminBookingsStackParamList, "AdminEditPayment">;
type Nav = NativeStackNavigationProp<
  AdminBookingsStackParamList,
  "AdminEditPayment"
>;

const METHOD_LABEL: Record<AdminPaymentMethod, string> = {
  CASH: "Cash",
  UPI_QR: "UPI QR",
  RAZORPAY: "Razorpay",
  PHONEPE: "PhonePe",
  FREE: "Free",
};
const METHODS: AdminPaymentMethod[] = [
  "CASH",
  "UPI_QR",
  "RAZORPAY",
  "PHONEPE",
  "FREE",
];

const STATUS_LABEL: Record<AdminPaymentStatus, string> = {
  PENDING: "Pending",
  PARTIAL: "Partial",
  COMPLETED: "Completed",
  REFUNDED: "Refunded",
  FAILED: "Failed",
};
const STATUSES: AdminPaymentStatus[] = [
  "PENDING",
  "PARTIAL",
  "COMPLETED",
  "REFUNDED",
  "FAILED",
];

/**
 * Mobile mirror of the web Edit Payment modal. Same patch semantics
 * (fields left blank stay as-is; gateway IDs cleared by emptying the
 * input). Seeds from the booking detail API on mount so the admin
 * sees current values without having to re-type them.
 *
 * Reachable from the Edit Payment action on the booking-detail
 * screen — admin pushes onto this screen, edits, hits Save, gets
 * popped back to the detail with invalidated booking cache.
 */
export function AdminEditPaymentScreen() {
  const { params } = useRoute<Rt>();
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();

  const detail = useQuery({
    queryKey: ["admin-booking", params.bookingId],
    queryFn: () => adminBookingsApi.detail(params.bookingId),
  });

  const [method, setMethod] = useState<AdminPaymentMethod | null>(null);
  // "Pass" pseudo-method — saving converts the booking to pass payment.
  const [usePass, setUsePass] = useState(false);
  const [status, setStatus] = useState<AdminPaymentStatus | null>(null);
  const [totalStr, setTotalStr] = useState("");
  const [isPartial, setIsPartial] = useState(false);
  const [advanceStr, setAdvanceStr] = useState("");
  const [razorpayId, setRazorpayId] = useState("");
  const [utr, setUtr] = useState("");
  const [note, setNote] = useState("");
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!detail.data || seeded) return;
    const b = detail.data.booking;
    const p = b.payment;
    if (p) {
      setMethod(p.method);
      setStatus(p.status);
      setTotalStr(String(b.totalAmount));
      setIsPartial(p.isPartialPayment);
      setAdvanceStr(p.advanceAmount === null ? "" : String(p.advanceAmount));
      setRazorpayId(p.razorpayPaymentId ?? "");
      setUtr(p.utrNumber ?? "");
    }
    setSeeded(true);
  }, [detail.data, seeded]);

  const booking = detail.data?.booking ?? null;
  const passConvert = booking?.passConvert ?? null;

  const parsedTotal = parseInt(totalStr, 10);
  const parsedAdvance =
    advanceStr.trim().length === 0 ? 0 : parseInt(advanceStr, 10);
  const totalValid = Number.isFinite(parsedTotal) && parsedTotal >= 0;
  const advanceValid =
    !isPartial ||
    (Number.isFinite(parsedAdvance) &&
      parsedAdvance >= 0 &&
      parsedAdvance < parsedTotal);

  const save = useMutation({
    mutationFn: () => {
      // Pass pseudo-method: convert the booking instead of patching.
      if (usePass) {
        return adminBookingsApi.convertToPass(
          params.bookingId,
          note.trim() || undefined,
        );
      }
      const b = detail.data!.booking;
      const p = b.payment!;

      // Diff against current values so the audit log doesn't get
      // noisy "method CASH → CASH" entries.
      //
      // totalAmount is the exception: always send it when the input
      // is valid. The previous diff-gate (`parsedTotal !==
      // b.totalAmount`) proved fragile on web — if the snapshot
      // lagged the DB by a render, the modal would think "no change"
      // and silently drop the field from the patch, so the save
      // succeeded but the booking total stayed stale. Mobile shipped
      // with the same gate, so port the same fix. The server's audit
      // log condition still checks the real diff against the fresh
      // booking row, so resaving the same number doesn't pollute
      // history.
      const patch: Parameters<typeof adminBookingsApi.editPayment>[1] = {};
      if (method && method !== p.method) patch.method = method;
      if (status && status !== p.status) patch.status = status;
      patch.totalAmount = parsedTotal;
      if (isPartial !== p.isPartialPayment) patch.isPartialPayment = isPartial;
      if (isPartial && parsedAdvance !== (p.advanceAmount ?? 0)) {
        patch.advanceAmount = parsedAdvance;
      }
      if (!isPartial && p.advanceAmount !== null) {
        patch.advanceAmount = null;
      }
      if (razorpayId !== (p.razorpayPaymentId ?? "")) {
        patch.razorpayPaymentId = razorpayId.trim() || null;
      }
      if (utr !== (p.utrNumber ?? "")) {
        patch.utrNumber = utr.trim() || null;
      }
      if (note.trim().length > 0) patch.note = note.trim();
      return adminBookingsApi.editPayment(params.bookingId, patch);
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ["admin-booking", params.bookingId],
      });
      void qc.invalidateQueries({ queryKey: ["admin-bookings"] });
      Alert.alert("Saved", "Payment updated.");
      navigation.goBack();
    },
    onError: (err) =>
      Alert.alert(
        "Couldn't save",
        err instanceof AdminApiError ? err.message : "Try again.",
      ),
  });

  const canSave =
    seeded && totalValid && advanceValid && !!method && !!status && !save.isPending;

  // Hooks BEFORE any conditional return — Rules of Hooks. Putting
  // useMemo below the early returns crashed with "Rendered more
  // hooks than during the previous render" the moment the loading
  // state resolved.
  const remaining = useMemo(
    () => Math.max(parsedTotal - parsedAdvance, 0),
    [parsedTotal, parsedAdvance],
  );

  if (detail.isLoading || !seeded) return <LoadingShell />;
  if (detail.isError || !detail.data?.booking.payment) {
    return (
      <Screen padded={false}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text variant="body" color={colors.destructive}>
            {detail.error instanceof Error
              ? detail.error.message
              : "Couldn't load this booking's payment."}
          </Text>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text variant="title">Edit Payment</Text>
        <Text variant="small" color={colors.zinc500}>
          Patch any field that changed. Leave the rest as-is — only
          differences land in the audit log.
        </Text>

        {/* Method */}
        <Field label="Method">
          <View style={styles.chipRow}>
            {METHODS.map((m) => (
              <Pressable
                key={m}
                onPress={() => {
                  setUsePass(false);
                  setMethod(m);
                }}
                style={[
                  styles.chip,
                  method === m && !usePass && styles.chipActive,
                ]}
              >
                <Text
                  variant="tiny"
                  color={
                    method === m && !usePass ? colors.emerald400 : colors.zinc300
                  }
                  weight="600"
                >
                  {METHOD_LABEL[m]}
                </Text>
              </Pressable>
            ))}
            {passConvert ? (
              <Pressable
                onPress={() => setUsePass(true)}
                style={[styles.chip, usePass && styles.chipActive]}
              >
                <Text
                  variant="tiny"
                  color={usePass ? colors.emerald400 : colors.zinc300}
                  weight="600"
                >
                  Pass
                </Text>
              </Pressable>
            ) : null}
          </View>
        </Field>

        {/* Move-to-pass panel — replaces the money fields while the
            Pass method is selected. */}
        {usePass && passConvert ? (
          <View style={styles.passPanel}>
            <Text variant="small" weight="600" color={colors.foreground}>
              Move this booking to pass payment
            </Text>
            {passConvert.passes.map((sh) => (
              <View key={sh.passName} style={styles.passPanelRow}>
                <Text variant="tiny" color={colors.emerald400}>
                  {sh.passName}
                </Text>
                <Text variant="tiny" color={colors.emerald400}>
                  {(sh.coveredMinutes / 60).toFixed(1).replace(/\.0$/, "")}h
                </Text>
              </View>
            ))}
            <Text variant="tiny" color={colors.zinc400}>
              {passConvert.fullCoverage
                ? "Fully covered — the payment becomes Pass / ₹0."
                : `Remainder ₹${passConvert.remainderAmount} stays on the current method to collect.`}
            </Text>
            {(booking?.payment?.amount ?? 0) > 0 &&
            (booking?.payment?.status === "COMPLETED" ||
              booking?.payment?.status === "PARTIAL") ? (
              <Text variant="tiny" color={colors.yellow400}>
                ₹{booking?.payment?.amount} was already collected — settle the
                refund with the customer separately (noted in the edit
                history).
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Status */}
        <Field label="Status">
          <View style={styles.chipRow}>
            {STATUSES.map((s) => (
              <Pressable
                key={s}
                onPress={() => setStatus(s)}
                style={[styles.chip, status === s && styles.chipActive]}
              >
                <Text
                  variant="tiny"
                  color={status === s ? colors.emerald400 : colors.zinc300}
                  weight="600"
                >
                  {STATUS_LABEL[s]}
                </Text>
              </Pressable>
            ))}
          </View>
        </Field>

        {/* Total */}
        <Field label="Total amount (₹)">
          <TextInput
            value={totalStr}
            onChangeText={setTotalStr}
            keyboardType="numeric"
            style={styles.input}
            placeholderTextColor={colors.zinc600}
          />
          {!totalValid ? (
            <Text variant="tiny" color={colors.destructive}>
              Enter a non-negative whole number.
            </Text>
          ) : null}
        </Field>

        {/* Partial advance */}
        <View style={styles.card}>
          <Pressable
            onPress={() => setIsPartial((v) => !v)}
            style={styles.toggleRow}
          >
            <View
              style={[
                styles.checkbox,
                isPartial && {
                  borderColor: colors.yellow400,
                  backgroundColor: "rgba(250, 204, 21, 0.18)",
                },
              ]}
            />
            <Text variant="small" color={colors.foreground} weight="600">
              Partial payment (advance + remainder)
            </Text>
          </Pressable>

          {isPartial ? (
            <View style={{ paddingLeft: 32, gap: 6 }}>
              <Text variant="tiny" color={colors.zinc500}>
                ADVANCE PAID (₹)
              </Text>
              <TextInput
                value={advanceStr}
                onChangeText={setAdvanceStr}
                keyboardType="numeric"
                style={[styles.input, { width: 160 }]}
                placeholderTextColor={colors.zinc600}
              />
              {!advanceValid ? (
                <Text variant="tiny" color={colors.destructive}>
                  Advance must be ≥ 0 and less than the total.
                </Text>
              ) : (
                <Text variant="tiny" color={colors.yellow400}>
                  Remaining at venue: ₹{remaining.toLocaleString("en-IN")}
                </Text>
              )}
            </View>
          ) : null}
        </View>

        {/* Razorpay ID */}
        {method === "RAZORPAY" || (detail.data?.booking.payment?.razorpayPaymentId) ? (
          <Field label="Razorpay payment ID">
            <TextInput
              value={razorpayId}
              onChangeText={setRazorpayId}
              placeholder="pay_…"
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { fontFamily: "Courier" }]}
              placeholderTextColor={colors.zinc600}
            />
          </Field>
        ) : null}

        {/* UTR */}
        {method === "UPI_QR" || (detail.data?.booking.payment?.utrNumber) ? (
          <Field label="UTR / reference">
            <TextInput
              value={utr}
              onChangeText={setUtr}
              placeholder="12-digit UTR"
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { fontFamily: "Courier" }]}
              placeholderTextColor={colors.zinc600}
            />
          </Field>
        ) : null}

        {/* Audit note */}
        <Field label="Note (optional)">
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="e.g. customer paid via Razorpay, gateway callback failed"
            multiline
            style={[styles.input, { minHeight: 60, textAlignVertical: "top" }]}
            placeholderTextColor={colors.zinc600}
          />
        </Field>

        {/* Actions */}
        <View style={styles.actions}>
          <Pressable
            onPress={() => navigation.goBack()}
            style={[styles.actionBtn, styles.actionNeutral]}
          >
            <XCircle size={14} color={colors.zinc300} />
            <Text variant="small" color={colors.zinc300} weight="600">
              Cancel
            </Text>
          </Pressable>
          <Pressable
            onPress={() => save.mutate()}
            disabled={!canSave}
            style={[
              styles.actionBtn,
              styles.actionPrimary,
              !canSave && { opacity: 0.5 },
            ]}
          >
            <Save size={14} color={colors.emerald400} />
            <Text variant="small" color={colors.emerald400} weight="600">
              {save.isPending ? "Saving…" : "Save Payment"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text variant="tiny" color={colors.zinc500} style={styles.fieldLabel}>
        {label.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

function LoadingShell() {
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Skeleton width="60%" height={28} />
        <Skeleton width="80%" height={11} />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} width="100%" height={48} rounded="md" />
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  passPanel: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.3)",
    backgroundColor: "rgba(16,185,129,0.05)",
    padding: spacing["3"],
    gap: spacing["2"],
  },
  passPanelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  fieldLabel: { letterSpacing: 1.5, fontWeight: "700" },
  input: {
    borderWidth: 1,
    borderColor: colors.zinc700,
    borderRadius: 8,
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2.5"],
    color: colors.foreground,
    backgroundColor: colors.background,
    fontSize: 14,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["2"],
  },
  chip: {
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["1.5"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  chipActive: {
    borderColor: "rgba(34, 197, 94, 0.40)",
    backgroundColor: "rgba(34, 197, 94, 0.10)",
  },
  card: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["3"],
    gap: spacing["2"],
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  actions: {
    flexDirection: "row",
    gap: spacing["2"],
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["1.5"],
    paddingVertical: spacing["3"],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  actionNeutral: {
    borderColor: colors.zinc800,
    backgroundColor: colors.background,
  },
  actionPrimary: {
    borderColor: "rgba(34, 197, 94, 0.30)",
    backgroundColor: "rgba(34, 197, 94, 0.10)",
  },
});
