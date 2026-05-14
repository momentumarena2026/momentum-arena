import { useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, Trash2, Wrench } from "lucide-react-native";
import { Text } from "../ui/Text";
import { Skeleton } from "../ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminBookingsApi,
  type AdminEquipmentCatalogItem,
  type AdminEquipmentRow,
} from "../../lib/admin-bookings";
import { formatRupees } from "../../lib/format";

interface Props {
  bookingId: string;
  paymentAmountRupees: number | null;
}

/**
 * Mobile twin of the web `EquipmentEditor` on /admin/bookings/[id].
 * Same operations: add from catalog, +/- quantity, delete a rental
 * row. Each mutation hits the same admin-equipment-rental action
 * via the mobile route and re-renders off the recomputed snapshot.
 */
export function AdminEquipmentEditor({ bookingId, paymentAmountRupees }: Props) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-booking-equipment", bookingId],
    queryFn: () => adminBookingsApi.equipmentSnapshot(bookingId),
  });

  const [pickerOpen, setPickerOpen] = useState(false);

  const mutate = useMutation({
    mutationFn: (
      body:
        | { op: "add"; equipmentId: string; quantity: number }
        | { op: "update"; rentalId: string; quantity: number }
        | { op: "remove"; rentalId: string },
    ) => adminBookingsApi.equipmentMutate(bookingId, body),
    onSuccess: (res) => {
      if (!res.success) {
        Alert.alert("Couldn't update", res.error ?? "Try again.");
        return;
      }
      // The mutation response carries the fresh snapshot — patch the
      // cache directly so the UI refreshes without a follow-up GET.
      qc.setQueryData(
        ["admin-booking-equipment", bookingId],
        (prev: typeof data) =>
          prev && res.rentals
            ? {
                ...prev,
                rentals: res.rentals,
                equipmentTotalRupees:
                  res.equipmentTotalRupees ?? prev.equipmentTotalRupees,
                bookingTotalRupees:
                  res.bookingTotalRupees ?? prev.bookingTotalRupees,
              }
            : prev,
      );
      // Also bust the booking detail cache so the Payment/Totals
      // section reflects the new bookingTotalRupees on next render.
      void qc.invalidateQueries({ queryKey: ["admin-booking", bookingId] });
    },
    onError: (err) => {
      Alert.alert(
        "Couldn't update",
        err instanceof Error ? err.message : "Try again.",
      );
    },
  });

  if (isLoading) {
    return (
      <View style={styles.section}>
        <SectionHeader />
        <Skeleton width="100%" height={48} rounded="md" />
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View style={styles.section}>
        <SectionHeader />
        <Text variant="small" color={colors.zinc500}>
          Couldn't load equipment for this booking.
        </Text>
      </View>
    );
  }

  const { rentals, catalog, equipmentTotalRupees, bookingTotalRupees } = data;
  const outstandingRupees =
    paymentAmountRupees !== null
      ? Math.max(0, bookingTotalRupees - paymentAmountRupees)
      : 0;

  return (
    <View style={styles.section}>
      <SectionHeader />

      {rentals.length === 0 ? (
        <Text variant="small" color={colors.zinc500} style={styles.empty}>
          No equipment rented yet.
        </Text>
      ) : (
        <View style={styles.rentalList}>
          {rentals.map((r) => (
            <RentalRow
              key={r.id}
              row={r}
              pending={mutate.isPending}
              onDecrement={() =>
                mutate.mutate({
                  op: "update",
                  rentalId: r.id,
                  quantity: Math.max(0, r.quantity - 1),
                })
              }
              onIncrement={() =>
                mutate.mutate({
                  op: "update",
                  rentalId: r.id,
                  quantity: r.quantity + 1,
                })
              }
              onRemove={() =>
                Alert.alert(
                  "Remove rental?",
                  `Remove ${r.name} from this booking?`,
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Remove",
                      style: "destructive",
                      onPress: () =>
                        mutate.mutate({ op: "remove", rentalId: r.id }),
                    },
                  ],
                )
              }
            />
          ))}
        </View>
      )}

      {catalog.length > 0 ? (
        <>
          <Pressable
            onPress={() => setPickerOpen((v) => !v)}
            style={({ pressed }) => [
              styles.addToggle,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Plus size={14} color={colors.emerald400} />
            <Text variant="small" weight="600" color={colors.emerald400}>
              {pickerOpen ? "Hide options" : "Add equipment"}
            </Text>
          </Pressable>
          {pickerOpen ? (
            <View style={styles.catalog}>
              {catalog.map((c) => (
                <CatalogPick
                  key={c.id}
                  item={c}
                  pending={mutate.isPending}
                  onAdd={() => {
                    mutate.mutate({
                      op: "add",
                      equipmentId: c.id,
                      quantity: 1,
                    });
                    setPickerOpen(false);
                  }}
                />
              ))}
            </View>
          ) : null}
        </>
      ) : null}

      <View style={styles.totals}>
        <View style={styles.totalRow}>
          <Text variant="small" color={colors.zinc400}>
            Rental total
          </Text>
          <Text variant="small" weight="600" color={colors.emerald400}>
            {formatRupees(equipmentTotalRupees)}
          </Text>
        </View>
        <View style={styles.totalRow}>
          <Text variant="small" color={colors.zinc400}>
            Booking total (now)
          </Text>
          <Text variant="small" weight="600" color={colors.foreground}>
            {formatRupees(bookingTotalRupees)}
          </Text>
        </View>
        {outstandingRupees > 0 ? (
          <View style={styles.outstanding}>
            <Text variant="tiny" color={colors.yellow400}>
              Collect at venue
            </Text>
            <Text variant="small" weight="700" color={colors.yellow400}>
              +{formatRupees(outstandingRupees)}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function SectionHeader() {
  return (
    <View style={styles.header}>
      <Wrench size={14} color={colors.zinc500} />
      <Text variant="tiny" color={colors.zinc500} style={styles.headerLabel}>
        EQUIPMENT RENTALS
      </Text>
    </View>
  );
}

function RentalRow({
  row,
  pending,
  onIncrement,
  onDecrement,
  onRemove,
}: {
  row: AdminEquipmentRow;
  pending: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.rental}>
      <Text variant="small" color={colors.foreground} style={styles.rentalName}>
        {row.name}
      </Text>
      <View style={styles.qty}>
        <Pressable
          onPress={onDecrement}
          disabled={pending}
          style={({ pressed }) => [
            styles.qtyBtn,
            pressed && { opacity: 0.7 },
            pending && { opacity: 0.6 },
          ]}
        >
          <Minus size={12} color={colors.zinc300} />
        </Pressable>
        <Text variant="small" weight="700" color={colors.foreground} style={styles.qtyNum}>
          {row.quantity}
        </Text>
        <Pressable
          onPress={onIncrement}
          disabled={pending}
          style={({ pressed }) => [
            styles.qtyBtn,
            pressed && { opacity: 0.7 },
            pending && { opacity: 0.6 },
          ]}
        >
          <Plus size={12} color={colors.zinc300} />
        </Pressable>
      </View>
      <Text variant="small" weight="600" color={colors.emerald400} style={styles.rentalPrice}>
        {formatRupees(Math.round(row.totalPricePaise / 100))}
      </Text>
      <Pressable
        onPress={onRemove}
        disabled={pending}
        style={({ pressed }) => [
          styles.removeBtn,
          pressed && { opacity: 0.7 },
          pending && { opacity: 0.6 },
        ]}
      >
        <Trash2 size={12} color={colors.destructive} />
      </Pressable>
    </View>
  );
}

function CatalogPick({
  item,
  pending,
  onAdd,
}: {
  item: AdminEquipmentCatalogItem;
  pending: boolean;
  onAdd: () => void;
}) {
  return (
    <Pressable
      onPress={onAdd}
      disabled={pending}
      style={({ pressed }) => [
        styles.catalogRow,
        pressed && { opacity: 0.85 },
        pending && { opacity: 0.6 },
      ]}
    >
      <Text variant="small" color={colors.foreground} style={styles.catalogName}>
        {item.name}
      </Text>
      <Text variant="small" weight="600" color={colors.zinc400}>
        +{formatRupees(Math.round(item.pricePerUnitPaise / 100))}
      </Text>
      <Plus size={14} color={colors.emerald400} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["4"],
    gap: spacing["3"],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  headerLabel: {
    letterSpacing: 1.5,
    fontWeight: "700",
  },
  empty: {
    paddingVertical: spacing["1"],
  },
  rentalList: {
    gap: spacing["2"],
  },
  rental: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    paddingVertical: spacing["2"],
    paddingHorizontal: spacing["3"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.background,
  },
  rentalName: {
    flex: 1,
  },
  qty: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
  },
  qtyBtn: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    alignItems: "center",
    justifyContent: "center",
  },
  qtyNum: {
    minWidth: 18,
    textAlign: "center",
  },
  rentalPrice: {
    minWidth: 56,
    textAlign: "right",
  },
  removeBtn: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.destructive_30,
    backgroundColor: colors.destructive_10,
    alignItems: "center",
    justifyContent: "center",
  },
  addToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
    paddingVertical: spacing["1.5"],
  },
  catalog: {
    gap: spacing["1.5"],
  },
  catalogRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2.5"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.background,
  },
  catalogName: {
    flex: 1,
  },
  totals: {
    borderTopWidth: 1,
    borderTopColor: colors.zinc800,
    paddingTop: spacing["3"],
    gap: spacing["1.5"],
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  outstanding: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing["2.5"],
    paddingVertical: spacing["2"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(234, 179, 8, 0.30)",
    backgroundColor: "rgba(234, 179, 8, 0.10)",
  },
});
