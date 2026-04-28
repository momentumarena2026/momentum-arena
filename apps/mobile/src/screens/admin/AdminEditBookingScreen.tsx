import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useRoute, useNavigation, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  CalendarDays,
  Check,
  Clock,
  Lock,
  MapPin,
  Save,
  XCircle,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminBookingsApi,
  AdminApiError,
  type AdminCourt,
  type AvailableSlot,
} from "../../lib/admin-bookings";
import {
  formatHourRangeCompact,
  formatRupees,
  sportLabel,
} from "../../lib/format";
import type { AdminBookingsStackParamList } from "../../navigation/types";

type Rt = RouteProp<AdminBookingsStackParamList, "AdminEditBooking">;
type Nav = NativeStackNavigationProp<
  AdminBookingsStackParamList,
  "AdminEditBooking"
>;

/**
 * Edit Booking — full edit. Lets the admin change court / date /
 * slots, plus advance amount + method on partial-payment bookings.
 * Mirrors the web `EditBookingModal`.
 *
 * Court grouping: courts come pre-sorted by sport; we render them in
 * collapsible sport sections so the picker doesn't dominate the
 * screen on small devices.
 */
export function AdminEditBookingScreen() {
  const { params } = useRoute<Rt>();
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();

  const detail = useQuery({
    queryKey: ["admin-booking", params.bookingId],
    queryFn: () => adminBookingsApi.detail(params.bookingId),
  });
  const courtsQuery = useQuery({
    queryKey: ["admin-courts"],
    queryFn: () => adminBookingsApi.courts(),
  });

  const booking = detail.data?.booking;

  // Local state
  const [date, setDate] = useState<string | null>(null);
  const [courtConfigId, setCourtConfigId] = useState<string | null>(null);
  const [hours, setHours] = useState<number[]>([]);
  const [advanceAmount, setAdvanceAmount] = useState<string>("");
  const [advanceMethod, setAdvanceMethod] = useState<"CASH" | "UPI_QR">(
    "UPI_QR",
  );

  useEffect(() => {
    if (booking && date === null) {
      setDate(booking.date.slice(0, 10));
      setCourtConfigId(booking.courtConfig.id);
      setHours(booking.slots.map((s) => s.startHour));
      if (booking.payment?.advanceAmount != null) {
        setAdvanceAmount(String(booking.payment.advanceAmount));
      }
      if (
        booking.payment?.method === "CASH" ||
        booking.payment?.method === "UPI_QR"
      ) {
        setAdvanceMethod(booking.payment.method);
      }
    }
  }, [booking, date]);

  const slotsQuery = useQuery({
    queryKey: ["admin-available-slots", params.bookingId, courtConfigId, date],
    queryFn: () =>
      adminBookingsApi.availableSlots(
        params.bookingId,
        courtConfigId!,
        date!,
      ),
    enabled: !!courtConfigId && !!date,
  });

  const save = useMutation({
    mutationFn: () => {
      const payload: Parameters<typeof adminBookingsApi.editBooking>[1] = {};
      if (date && date !== booking?.date.slice(0, 10)) payload.newDate = date;
      if (courtConfigId && courtConfigId !== booking?.courtConfig.id) {
        payload.newCourtConfigId = courtConfigId;
      }
      const sortedCurrent = (booking?.slots.map((s) => s.startHour) ?? []).slice().sort();
      const sortedNew = hours.slice().sort();
      const slotsChanged =
        sortedCurrent.length !== sortedNew.length ||
        sortedCurrent.some((h, i) => h !== sortedNew[i]);
      if (slotsChanged) payload.newHours = hours;
      // Advance edits only sent for partial bookings.
      if (
        booking?.payment?.isPartialPayment &&
        advanceAmount !== "" &&
        Math.trunc(parseFloat(advanceAmount) || 0) !==
          (booking.payment.advanceAmount ?? 0)
      ) {
        payload.newAdvanceAmount = Math.trunc(parseFloat(advanceAmount));
      }
      if (
        booking?.payment?.isPartialPayment &&
        advanceMethod !== booking.payment.method &&
        (advanceMethod === "CASH" || advanceMethod === "UPI_QR")
      ) {
        payload.newAdvanceMethod = advanceMethod;
      }
      return adminBookingsApi.editBooking(params.bookingId, payload);
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ["admin-booking", params.bookingId],
      });
      void qc.invalidateQueries({ queryKey: ["admin-bookings"] });
      Alert.alert("Saved", "Booking updated.");
      navigation.goBack();
    },
    onError: (err) =>
      Alert.alert(
        "Couldn't save",
        err instanceof AdminApiError ? err.message : "Try again.",
      ),
  });

  const previewTotal = useMemo(() => {
    if (!slotsQuery.data) return null;
    return slotsQuery.data.slots
      .filter((s) => hours.includes(s.hour))
      .reduce((sum, s) => sum + s.price, 0);
  }, [slotsQuery.data, hours]);

  if (detail.isLoading || !booking || date === null || !courtsQuery.data) {
    return <LoadingShell />;
  }

  function toggleHour(h: number, slot: AvailableSlot) {
    if (slot.isBlocked || slot.isBooked) return;
    setHours((curr) =>
      curr.includes(h)
        ? curr.filter((x) => x !== h)
        : [...curr, h].sort((a, b) => a - b),
    );
  }

  // Group courts by sport so the picker reads "🏏 Cricket / 🏐 etc."
  const groupedCourts = courtsQuery.data.courts.reduce(
    (acc, c) => {
      (acc[c.sport] ??= []).push(c);
      return acc;
    },
    {} as Record<string, AdminCourt[]>,
  );

  const isPartial = !!booking.payment?.isPartialPayment;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text variant="title">Edit Booking</Text>
        <Text variant="small" color={colors.zinc500}>
          Change court, date, slots, or advance. The action re-validates
          availability + zone overlap and recomputes pricing.
        </Text>

        {/* Court picker */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <MapPin size={14} color={colors.zinc500} />
            <Text variant="tiny" color={colors.zinc500} style={styles.cardTitle}>
              COURT
            </Text>
          </View>
          {Object.entries(groupedCourts).map(([sport, list]) => (
            <View key={sport} style={styles.sportSection}>
              <Text variant="tiny" color={colors.zinc500} weight="600">
                {sportEmoji(sport)} {sportLabel(sport)}
              </Text>
              <View style={styles.courtRow}>
                {list.map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => setCourtConfigId(c.id)}
                    style={({ pressed }) => [
                      styles.courtChip,
                      courtConfigId === c.id && styles.courtChipSelected,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Text
                      variant="small"
                      color={
                        courtConfigId === c.id
                          ? colors.emerald400
                          : colors.zinc300
                      }
                      weight="500"
                    >
                      {c.label}
                    </Text>
                    <Text variant="tiny" color={colors.zinc500}>
                      {c.widthFt}×{c.lengthFt}ft
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </View>

        {/* Date */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <CalendarDays size={14} color={colors.zinc500} />
            <Text variant="tiny" color={colors.zinc500} style={styles.cardTitle}>
              DATE
            </Text>
          </View>
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.zinc600}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.dateInput}
          />
        </View>

        {/* Slot grid */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Clock size={14} color={colors.zinc500} />
            <Text variant="tiny" color={colors.zinc500} style={styles.cardTitle}>
              SLOTS · {hours.length} selected
            </Text>
            {previewTotal !== null ? (
              <Text variant="small" color={colors.emerald400} style={styles.totalChip}>
                {formatRupees(previewTotal)}
              </Text>
            ) : null}
          </View>
          {slotsQuery.isLoading ? (
            <View style={styles.grid}>
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton key={i} width="48%" height={48} rounded="md" />
              ))}
            </View>
          ) : slotsQuery.isError ? (
            <Text variant="small" color={colors.destructive}>
              Couldn't load availability for this court+date.
            </Text>
          ) : (
            <View style={styles.grid}>
              {slotsQuery.data?.slots.map((s) => (
                <SlotTile
                  key={s.hour}
                  slot={s}
                  selected={hours.includes(s.hour)}
                  onToggle={() => toggleHour(s.hour, s)}
                />
              ))}
            </View>
          )}
        </View>

        {/* Advance editor — only for partial bookings */}
        {isPartial ? (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Banknote size={14} color={colors.yellow400} />
              <Text variant="tiny" color={colors.zinc500} style={styles.cardTitle}>
                ADVANCE
              </Text>
            </View>
            <View style={styles.fieldRow}>
              <View style={styles.field}>
                <Text variant="tiny" color={colors.zinc500} style={styles.fieldLabel}>
                  AMOUNT (₹)
                </Text>
                <TextInput
                  keyboardType="numeric"
                  value={advanceAmount}
                  onChangeText={setAdvanceAmount}
                  style={styles.dateInput}
                />
              </View>
              <View style={styles.field}>
                <Text variant="tiny" color={colors.zinc500} style={styles.fieldLabel}>
                  METHOD
                </Text>
                <View style={{ flexDirection: "row", gap: spacing["2"] }}>
                  {(["CASH", "UPI_QR"] as const).map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => setAdvanceMethod(m)}
                      style={[
                        styles.methodChip,
                        advanceMethod === m && styles.methodChipSelected,
                      ]}
                    >
                      <Text
                        variant="small"
                        color={
                          advanceMethod === m
                            ? colors.yellow400
                            : colors.zinc400
                        }
                        weight="500"
                      >
                        {m === "UPI_QR" ? "UPI QR" : "Cash"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
          </View>
        ) : null}

        {/* Save / Cancel */}
        <View style={styles.actions}>
          <Pressable
            onPress={() => navigation.goBack()}
            style={[styles.actionBtn, styles.actionNeutral]}
          >
            <XCircle size={16} color={colors.zinc300} />
            <Text variant="small" color={colors.zinc300} weight="600">
              Cancel
            </Text>
          </Pressable>
          <Pressable
            onPress={() => save.mutate()}
            disabled={save.isPending || hours.length === 0}
            style={[
              styles.actionBtn,
              styles.actionPrimary,
              (save.isPending || hours.length === 0) && { opacity: 0.5 },
            ]}
          >
            <Save size={16} color={colors.emerald400} />
            <Text variant="small" color={colors.emerald400} weight="600">
              {save.isPending ? "Saving…" : "Save changes"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

function SlotTile({
  slot,
  selected,
  onToggle,
}: {
  slot: AvailableSlot;
  selected: boolean;
  onToggle: () => void;
}) {
  const disabled = slot.isBlocked || slot.isBooked;
  const label = formatHourRangeCompact(slot.hour);
  return (
    <Pressable
      onPress={onToggle}
      disabled={disabled}
      style={({ pressed }) => [
        styles.tile,
        selected && styles.tileSelected,
        disabled && styles.tileDisabled,
        pressed && !disabled && { opacity: 0.7 },
      ]}
    >
      <View style={styles.tileTop}>
        {disabled ? (
          <Lock size={12} color={colors.zinc600} />
        ) : selected ? (
          <Check size={12} color={colors.emerald400} />
        ) : null}
        <Text
          variant="small"
          color={
            disabled
              ? colors.zinc600
              : selected
                ? colors.emerald400
                : colors.foreground
          }
          weight="600"
        >
          {label}
        </Text>
      </View>
      <Text
        variant="tiny"
        color={
          disabled
            ? colors.zinc700
            : selected
              ? colors.emerald400
              : colors.zinc500
        }
      >
        {disabled
          ? slot.isBooked
            ? "Booked"
            : slot.blockReason || "Blocked"
          : formatRupees(slot.price)}
      </Text>
    </Pressable>
  );
}

function LoadingShell() {
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Skeleton width="60%" height={28} />
        <Skeleton width="80%" height={11} />
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.card}>
            <Skeleton width="40%" height={11} />
            <Skeleton width="100%" height={48} />
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

function sportEmoji(s: string): string {
  return s === "CRICKET" ? "🏏" : s === "FOOTBALL" ? "⚽" : "🏓";
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["4"],
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
  totalChip: {
    marginLeft: "auto",
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(34, 197, 94, 0.30)",
    backgroundColor: "rgba(34, 197, 94, 0.10)",
  },
  sportSection: { gap: spacing["2"] },
  courtRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["2"],
  },
  courtChip: {
    paddingVertical: spacing["2"],
    paddingHorizontal: spacing["3"],
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc800_50,
    minWidth: 120,
  },
  courtChipSelected: {
    borderColor: "rgba(34, 197, 94, 0.50)",
    backgroundColor: "rgba(34, 197, 94, 0.10)",
  },
  dateInput: {
    borderWidth: 1,
    borderColor: colors.zinc700,
    borderRadius: 8,
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["3"],
    color: colors.foreground,
    backgroundColor: colors.background,
    fontSize: 16,
    fontFamily: "Courier",
  },
  fieldRow: {
    flexDirection: "row",
    gap: spacing["3"],
  },
  field: { flex: 1, gap: spacing["1.5"] },
  fieldLabel: { letterSpacing: 1, fontWeight: "700" },
  methodChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing["2.5"],
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc800_50,
  },
  methodChipSelected: {
    borderColor: "rgba(245, 158, 11, 0.40)",
    backgroundColor: "rgba(245, 158, 11, 0.10)",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["2"],
  },
  tile: {
    width: "48%",
    paddingVertical: spacing["2.5"],
    paddingHorizontal: spacing["3"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc800_50,
    gap: 4,
  },
  tileSelected: {
    borderColor: "rgba(34, 197, 94, 0.50)",
    backgroundColor: "rgba(34, 197, 94, 0.10)",
  },
  tileDisabled: { opacity: 0.5 },
  tileTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
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
    gap: spacing["2"],
    paddingVertical: spacing["3"],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  actionNeutral: {
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  actionPrimary: {
    borderColor: "rgba(34, 197, 94, 0.30)",
    backgroundColor: "rgba(34, 197, 94, 0.10)",
  },
});
