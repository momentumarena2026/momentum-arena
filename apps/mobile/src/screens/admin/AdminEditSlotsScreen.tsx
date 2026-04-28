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
  CalendarDays,
  Check,
  Clock,
  Lock,
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
  type AvailableSlot,
} from "../../lib/admin-bookings";
import {
  formatHourRangeCompact,
  formatRupees,
} from "../../lib/format";
import type { AdminBookingsStackParamList } from "../../navigation/types";

type Rt = RouteProp<AdminBookingsStackParamList, "AdminEditSlots">;
type Nav = NativeStackNavigationProp<
  AdminBookingsStackParamList,
  "AdminEditSlots"
>;

/**
 * Edit Slots — change date and/or slot range for an existing booking
 * without touching the court. Mirrors the web `EditSlotsModal`.
 *
 * Flow:
 *   1. Fetch the booking detail to seed the picker (current date,
 *      current court, current selected hours).
 *   2. Fetch available-slots for the chosen date + court (excluding
 *      this booking from the conflict check so its own current hours
 *      stay selectable).
 *   3. User toggles hours and/or changes date → preview total updates.
 *   4. Save → POST /api/mobile/admin/bookings/[id]/edit-slots.
 */
export function AdminEditSlotsScreen() {
  const { params } = useRoute<Rt>();
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();

  const detail = useQuery({
    queryKey: ["admin-booking", params.bookingId],
    queryFn: () => adminBookingsApi.detail(params.bookingId),
  });

  const booking = detail.data?.booking;

  // Seed local state once the booking loads.
  const [date, setDate] = useState<string | null>(null);
  const [hours, setHours] = useState<number[]>([]);

  useEffect(() => {
    if (booking && date === null) {
      setDate(booking.date.slice(0, 10));
      setHours(booking.slots.map((s) => s.startHour));
    }
  }, [booking, date]);

  const slotsQuery = useQuery({
    queryKey: [
      "admin-available-slots",
      params.bookingId,
      booking?.courtConfig.id ?? null,
      date,
    ],
    queryFn: () =>
      adminBookingsApi.availableSlots(
        params.bookingId,
        booking!.courtConfig.id,
        date!,
      ),
    enabled: !!booking && !!date,
  });

  const save = useMutation({
    mutationFn: () =>
      adminBookingsApi.editSlots(params.bookingId, {
        hours,
        date: date && date !== booking?.date.slice(0, 10) ? date : undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ["admin-booking", params.bookingId],
      });
      void qc.invalidateQueries({ queryKey: ["admin-bookings"] });
      Alert.alert("Saved", "Slots updated.");
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

  if (detail.isLoading || !booking || date === null) {
    return <LoadingShell />;
  }

  function toggleHour(h: number, slot: AvailableSlot) {
    if (slot.isBlocked) return;
    if (slot.isBooked) return;
    setHours((curr) =>
      curr.includes(h) ? curr.filter((x) => x !== h) : [...curr, h].sort((a, b) => a - b),
    );
  }

  const dirty =
    date !== booking.date.slice(0, 10) ||
    hours.length !== booking.slots.length ||
    hours.some((h, i) => h !== booking.slots[i]?.startHour);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text variant="title">Edit Slots</Text>
        <Text variant="small" color={colors.zinc500}>
          {booking.courtConfig.label} · pick a new date or change the slot
          range. Pricing recomputes on save.
        </Text>

        {/* Date input */}
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
          <Text variant="tiny" color={colors.zinc600}>
            Format: 2026-04-30. Used to recompute availability + pricing.
          </Text>
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
              Couldn't load availability. Pull back and retry.
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
            disabled={!dirty || save.isPending || hours.length === 0}
            style={[
              styles.actionBtn,
              styles.actionPrimary,
              (!dirty || save.isPending || hours.length === 0) && {
                opacity: 0.5,
              },
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
        <View style={styles.card}>
          <Skeleton width="30%" height={11} />
          <Skeleton width="100%" height={40} rounded="md" />
        </View>
        <View style={styles.card}>
          <Skeleton width="40%" height={11} />
          <View style={styles.grid}>
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} width="48%" height={48} rounded="md" />
            ))}
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
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
  tileDisabled: {
    opacity: 0.5,
  },
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
