import { useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, Plus, Trash2, X } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminEquipmentApi,
  type AdminEquipment,
} from "../../lib/admin-equipment";
import { formatRupees, sportLabel } from "../../lib/format";
import { AdminApiError } from "../../lib/admin-api";

const SPORTS: Array<{ value: string | null; label: string }> = [
  { value: null, label: "All sports" },
  { value: "CRICKET", label: "Cricket" },
  { value: "FOOTBALL", label: "Football" },
  { value: "PICKLEBALL", label: "Pickleball" },
];

export function AdminEquipmentScreen() {
  const qc = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const list = useQuery({
    queryKey: ["admin", "equipment", showInactive],
    queryFn: () => adminEquipmentApi.list(showInactive),
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdminEquipment | null>(null);
  const [name, setName] = useState("");
  const [sport, setSport] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [units, setUnits] = useState("");
  const [selectable, setSelectable] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setName("");
    setSport(null);
    setPrice("");
    setUnits("");
    setSelectable(true);
    setErr(null);
    setOpen(true);
  }
  function openEdit(e: AdminEquipment) {
    setEditing(e);
    setName(e.name);
    setSport(e.sport);
    setPrice(String(e.pricePerHour));
    setUnits(String(e.totalUnits));
    setSelectable(e.isCustomerSelectable);
    setErr(null);
    setOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const priceNum = Number(price);
      const unitsNum = Number(units);
      if (!name.trim()) throw new Error("Name is required");
      if (!priceNum || priceNum <= 0) throw new Error("Enter a valid price");
      if (!unitsNum || unitsNum <= 0) throw new Error("Enter total units");
      const body = {
        name: name.trim(),
        sport,
        pricePerHour: priceNum,
        totalUnits: unitsNum,
        isCustomerSelectable: selectable,
      };
      if (editing) await adminEquipmentApi.update(editing.id, body);
      else await adminEquipmentApi.create(body);
    },
    onSuccess: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["admin", "equipment"] });
    },
    onError: (e) =>
      setErr(e instanceof AdminApiError || e instanceof Error ? e.message : "Failed"),
  });

  const toggle = useMutation({
    mutationFn: (e: AdminEquipment) =>
      adminEquipmentApi.update(e.id, { isActive: !e.isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "equipment"] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => adminEquipmentApi.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "equipment"] }),
  });

  const equipment = list.data?.equipment ?? [];

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && !list.isLoading}
            onRefresh={() => void list.refetch()}
            tintColor={colors.zinc400}
          />
        }
      >
        <View style={styles.topRow}>
          <Pressable
            onPress={() => setShowInactive((v) => !v)}
            style={styles.inactiveToggle}
          >
            <Text variant="small" color={colors.zinc400}>
              {showInactive ? "Showing all" : "Active only"}
            </Text>
          </Pressable>
          <Button
            label="New"
            onPress={openCreate}
            leadingIcon={<Plus size={16} color={colors.primaryForeground} />}
          />
        </View>

        {list.isLoading ? (
          <View style={styles.list}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} width="100%" height={64} />
            ))}
          </View>
        ) : equipment.length === 0 ? (
          <View style={styles.empty}>
            <Package size={34} color={colors.zinc600} />
            <Text variant="small" color={colors.zinc500} style={{ marginTop: spacing["2"] }}>
              No equipment yet.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {equipment.map((e) => (
              <Card key={e.id} style={styles.row}>
                <Pressable onPress={() => openEdit(e)} style={{ flex: 1 }}>
                  <Text variant="body" weight="500" color={colors.foreground}>
                    {e.name}
                  </Text>
                  <Text variant="tiny" color={colors.zinc500}>
                    {formatRupees(e.pricePerHour)}/hr · {e.availableUnits}/
                    {e.totalUnits} units
                    {e.sport ? ` · ${sportLabel(e.sport)}` : " · All sports"}
                    {!e.isCustomerSelectable ? " · staff-only" : ""}
                  </Text>
                </Pressable>
                <View style={styles.rowActions}>
                  <Switch
                    value={e.isActive}
                    onValueChange={() => toggle.mutate(e)}
                    trackColor={{ true: colors.emerald500_10, false: colors.zinc700 }}
                    thumbColor={e.isActive ? colors.emerald400 : colors.zinc400}
                  />
                  <Pressable
                    hitSlop={8}
                    onPress={() =>
                      Alert.alert("Delete equipment?", `Remove ${e.name}?`, [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Delete",
                          style: "destructive",
                          onPress: () => remove.mutate(e.id),
                        },
                      ])
                    }
                  >
                    <Trash2 size={16} color={colors.destructive} />
                  </Pressable>
                </View>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text variant="title" weight="700">
                {editing ? "Edit equipment" : "New equipment"}
              </Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                <X size={22} color={colors.zinc400} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody}>
              <Input label="Name" placeholder="Bowling kit" value={name} onChangeText={setName} />
              <Text variant="tiny" color={colors.zinc500} style={styles.fieldLabel}>
                SPORT
              </Text>
              <View style={styles.sportRow}>
                {SPORTS.map((s) => (
                  <Pressable
                    key={s.label}
                    onPress={() => setSport(s.value)}
                    style={[styles.sportChip, sport === s.value && styles.sportChipActive]}
                  >
                    <Text
                      variant="tiny"
                      weight="600"
                      color={sport === s.value ? colors.emerald400 : colors.zinc400}
                    >
                      {s.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}>
                  <Input label="Price/hr ₹" keyboardType="numeric" value={price} onChangeText={setPrice} />
                </View>
                <View style={{ flex: 1 }}>
                  <Input label="Total units" keyboardType="numeric" value={units} onChangeText={setUnits} />
                </View>
              </View>
              <View style={styles.selectableRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="small" weight="500" color={colors.foreground}>
                    Customer-selectable
                  </Text>
                  <Text variant="tiny" color={colors.zinc500}>
                    Show on the customer booking rental list
                  </Text>
                </View>
                <Switch
                  value={selectable}
                  onValueChange={setSelectable}
                  trackColor={{ true: colors.emerald500_10, false: colors.zinc700 }}
                  thumbColor={selectable ? colors.emerald400 : colors.zinc400}
                />
              </View>
              {err ? (
                <Text variant="small" color={colors.destructive} style={{ marginTop: spacing["2"] }}>
                  {err}
                </Text>
              ) : null}
            </ScrollView>
            <View style={styles.modalFooter}>
              <Button
                label={editing ? "Save changes" : "Create"}
                onPress={() => save.mutate()}
                loading={save.isPending}
                fullWidth
                size="lg"
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["10"],
    gap: spacing["4"],
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  inactiveToggle: {
    paddingVertical: spacing["2"],
    paddingHorizontal: spacing["3"],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc700,
  },
  list: { gap: spacing["3"] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    padding: spacing["4"],
  },
  rowActions: { flexDirection: "row", alignItems: "center", gap: spacing["3"] },
  empty: { alignItems: "center", paddingVertical: spacing["12"] },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: "90%",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  modalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing["5"],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modalBody: { padding: spacing["5"], gap: spacing["3"] },
  modalFooter: {
    padding: spacing["5"],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  fieldLabel: { letterSpacing: 1.2, fontWeight: "700", marginTop: spacing["1"] },
  sportRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing["2"] },
  sportChip: {
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  sportChipActive: { borderColor: colors.emerald400, backgroundColor: colors.emerald500_10 },
  twoCol: { flexDirection: "row", gap: spacing["3"] },
  selectableRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    marginTop: spacing["1"],
  },
});
