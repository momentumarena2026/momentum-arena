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
import { Lock, Plus, Tag, Trash2, X } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminDiscountsApi,
  type AdminDiscountCode,
  type DiscountSport,
  type DiscountType,
} from "../../lib/admin-discounts";
import { formatRupees } from "../../lib/format";
import { AdminApiError } from "../../lib/admin-api";

const SPORTS: DiscountSport[] = ["CRICKET", "FOOTBALL", "PICKLEBALL"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function discountLabel(c: AdminDiscountCode): string {
  // PERCENTAGE value = basis points (1000 = 10%); FLAT value = rupees.
  return c.type === "PERCENTAGE"
    ? `${c.value / 100}% OFF`
    : `${formatRupees(c.value)} OFF`;
}

export function AdminDiscountsScreen() {
  const qc = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const list = useQuery({
    queryKey: ["admin", "discounts", showInactive],
    queryFn: () => adminDiscountsApi.list(showInactive),
  });

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminDiscountCode | null>(null);
  const [code, setCode] = useState("");
  const [type, setType] = useState<DiscountType>("PERCENTAGE");
  const [value, setValue] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [perUser, setPerUser] = useState("1");
  const [minBooking, setMinBooking] = useState("");
  const [sports, setSports] = useState<Set<DiscountSport>>(new Set());
  const [from, setFrom] = useState(isoDate(new Date()));
  const [until, setUntil] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return isoDate(d);
  });
  const [err, setErr] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setCode("");
    setType("PERCENTAGE");
    setValue("");
    setMaxUses("");
    setPerUser("1");
    setMinBooking("");
    setSports(new Set());
    setFrom(isoDate(new Date()));
    const d = new Date();
    d.setDate(d.getDate() + 30);
    setUntil(isoDate(d));
    setErr(null);
    setFormOpen(true);
  }

  function openEdit(c: AdminDiscountCode) {
    setEditing(c);
    setCode(c.code);
    setType(c.type);
    setValue(String(c.type === "PERCENTAGE" ? c.value / 100 : c.value));
    setMaxUses(c.maxUses != null ? String(c.maxUses) : "");
    setPerUser(String(c.maxUsesPerUser));
    setMinBooking(c.minBookingAmount != null ? String(c.minBookingAmount) : "");
    setSports(new Set(c.sportFilter));
    setFrom(c.validFrom.slice(0, 10));
    setUntil(c.validUntil.slice(0, 10));
    setErr(null);
    setFormOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const num = Number(value);
      if (!num || num <= 0) throw new Error("Enter a valid discount value");
      // PERCENTAGE is stored as basis points (10% → 1000); FLAT as rupees.
      const storedValue = type === "PERCENTAGE" ? Math.round(num * 100) : Math.round(num);
      const common = {
        value: storedValue,
        maxUses: maxUses ? Number(maxUses) : undefined,
        maxUsesPerUser: perUser ? Number(perUser) : 1,
        minBookingAmount: minBooking ? Number(minBooking) : undefined,
        sportFilter: Array.from(sports),
        validFrom: from,
        validUntil: until,
      };
      if (editing) {
        await adminDiscountsApi.update(editing.id, common);
      } else {
        if (code.trim().length < 3) throw new Error("Code must be 3+ characters");
        await adminDiscountsApi.create({ code: code.trim(), type, ...common });
      }
    },
    onSuccess: () => {
      setFormOpen(false);
      void qc.invalidateQueries({ queryKey: ["admin", "discounts"] });
    },
    onError: (e) =>
      setErr(e instanceof AdminApiError || e instanceof Error ? e.message : "Failed"),
  });

  const toggle = useMutation({
    mutationFn: (c: AdminDiscountCode) =>
      adminDiscountsApi.update(c.id, { isActive: !c.isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "discounts"] }),
    onError: (e) =>
      Alert.alert("Failed", e instanceof Error ? e.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminDiscountsApi.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "discounts"] }),
    onError: (e) =>
      Alert.alert("Failed", e instanceof Error ? e.message : "Failed"),
  });

  const codes = list.data?.codes ?? [];

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
            label="New code"
            onPress={openCreate}
            leadingIcon={<Plus size={16} color={colors.primaryForeground} />}
          />
        </View>

        {list.isLoading ? (
          <View style={styles.list}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.skeleton}>
                <Skeleton width={110} height={20} />
                <Skeleton width="70%" height={12} />
              </View>
            ))}
          </View>
        ) : codes.length === 0 ? (
          <View style={styles.empty}>
            <Tag size={34} color={colors.zinc600} />
            <Text variant="small" color={colors.zinc500} style={{ marginTop: spacing["2"] }}>
              No discount codes yet.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {codes.map((c) => (
              <Card key={c.id} style={styles.couponCard}>
                <View style={styles.couponHead}>
                  <Pressable onPress={() => openEdit(c)} style={{ flex: 1 }}>
                    <View style={styles.codeRow}>
                      <Tag size={14} color={colors.emerald400} />
                      <Text variant="bodyStrong" color={colors.foreground}>
                        {c.code}
                      </Text>
                      {c.isSystemCode ? (
                        <Lock size={12} color={colors.zinc500} />
                      ) : null}
                      <View style={styles.discPill}>
                        <Text variant="tiny" weight="700" color={colors.emerald400}>
                          {discountLabel(c)}
                        </Text>
                      </View>
                    </View>
                    <Text variant="tiny" color={colors.zinc500} style={{ marginTop: 2 }}>
                      {c.minBookingAmount ? `Min ${formatRupees(c.minBookingAmount)} · ` : ""}
                      {c.usages} used
                      {c.maxUses ? ` / ${c.maxUses}` : ""} · till{" "}
                      {c.validUntil.slice(0, 10)}
                    </Text>
                    {c.sportFilter.length > 0 ? (
                      <Text variant="tiny" color={colors.zinc600} style={{ marginTop: 1 }}>
                        {c.sportFilter.join(", ")}
                      </Text>
                    ) : null}
                  </Pressable>
                  <View style={styles.couponActions}>
                    <Switch
                      value={c.isActive}
                      onValueChange={() => toggle.mutate(c)}
                      trackColor={{ true: colors.emerald500_10, false: colors.zinc700 }}
                      thumbColor={c.isActive ? colors.emerald400 : colors.zinc400}
                    />
                    {!c.isSystemCode ? (
                      <Pressable
                        hitSlop={8}
                        onPress={() =>
                          Alert.alert("Deactivate code?", `Disable ${c.code}?`, [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Deactivate",
                              style: "destructive",
                              onPress: () => remove.mutate(c.id),
                            },
                          ])
                        }
                      >
                        <Trash2 size={16} color={colors.destructive} />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Create / edit modal */}
      <Modal
        visible={formOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setFormOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text variant="title" weight="700">
                {editing ? "Edit code" : "New discount code"}
              </Text>
              <Pressable onPress={() => setFormOpen(false)} hitSlop={8}>
                <X size={22} color={colors.zinc400} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody}>
              {!editing ? (
                <Input
                  label="Code"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder="SUMMER20"
                  value={code}
                  onChangeText={setCode}
                />
              ) : null}

              {!editing ? (
                <View style={styles.typeRow}>
                  {(["PERCENTAGE", "FLAT"] as DiscountType[]).map((t) => (
                    <Pressable
                      key={t}
                      onPress={() => setType(t)}
                      style={[styles.typeChip, type === t && styles.typeChipActive]}
                    >
                      <Text
                        variant="small"
                        weight="600"
                        color={type === t ? colors.emerald400 : colors.zinc400}
                      >
                        {t === "PERCENTAGE" ? "Percentage" : "Flat ₹"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <Input
                label={type === "PERCENTAGE" ? "Discount %" : "Discount ₹"}
                keyboardType="numeric"
                placeholder={type === "PERCENTAGE" ? "10" : "100"}
                value={value}
                onChangeText={setValue}
              />
              <Input
                label="Min booking ₹ (optional)"
                keyboardType="numeric"
                value={minBooking}
                onChangeText={setMinBooking}
              />
              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}>
                  <Input
                    label="Max uses (total)"
                    keyboardType="numeric"
                    placeholder="∞"
                    value={maxUses}
                    onChangeText={setMaxUses}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Input
                    label="Per user"
                    keyboardType="numeric"
                    value={perUser}
                    onChangeText={setPerUser}
                  />
                </View>
              </View>
              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}>
                  <Input label="Valid from" placeholder="YYYY-MM-DD" value={from} onChangeText={setFrom} />
                </View>
                <View style={{ flex: 1 }}>
                  <Input label="Valid until" placeholder="YYYY-MM-DD" value={until} onChangeText={setUntil} />
                </View>
              </View>

              <Text variant="tiny" color={colors.zinc500} style={styles.catLabel}>
                SPORTS (empty = all)
              </Text>
              <View style={styles.catRow}>
                {SPORTS.map((sport) => {
                  const on = sports.has(sport);
                  return (
                    <Pressable
                      key={sport}
                      onPress={() =>
                        setSports((prev) => {
                          const next = new Set(prev);
                          if (next.has(sport)) next.delete(sport);
                          else next.add(sport);
                          return next;
                        })
                      }
                      style={[styles.catChip, on && styles.catChipActive]}
                    >
                      <Text
                        variant="tiny"
                        weight="600"
                        color={on ? colors.emerald400 : colors.zinc400}
                      >
                        {sport}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {err ? (
                <Text variant="small" color={colors.destructive} style={{ marginTop: spacing["2"] }}>
                  {err}
                </Text>
              ) : null}
            </ScrollView>
            <View style={styles.modalFooter}>
              <Button
                label={editing ? "Save changes" : "Create code"}
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
  couponCard: { padding: spacing["4"] },
  couponHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing["3"] },
  codeRow: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  discPill: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.emerald500_10,
  },
  couponActions: { alignItems: "center", gap: spacing["2"] },
  skeleton: {
    padding: spacing["4"],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    gap: spacing["2"],
  },
  empty: { alignItems: "center", paddingVertical: spacing["12"] },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
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
  typeRow: { flexDirection: "row", gap: spacing["2"] },
  typeChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  typeChipActive: { borderColor: colors.emerald400, backgroundColor: colors.emerald500_10 },
  twoCol: { flexDirection: "row", gap: spacing["3"] },
  catLabel: { letterSpacing: 1.2, fontWeight: "700", marginTop: spacing["1"] },
  catRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing["2"] },
  catChip: {
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  catChipActive: { borderColor: colors.emerald400, backgroundColor: colors.emerald500_10 },
});
