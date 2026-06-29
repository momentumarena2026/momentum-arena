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
import { Plus, Ticket, Trash2, X } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminCouponsApi,
  type AdminCoupon,
  type CouponScope,
  type CouponType,
} from "../../lib/admin-coupons";
import { formatRupees } from "../../lib/format";
import { AdminApiError } from "../../lib/admin-api";

const SCOPES: CouponScope[] = ["BOTH", "SPORTS", "CAFE"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function isoDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function discountLabel(c: AdminCoupon): string {
  // PERCENTAGE: value = basis points (÷100 → percent). FLAT: value = whole
  // RUPEES (canonical — matches the web admin + the coupon validator).
  // maxDiscount is also whole rupees.
  return c.type === "PERCENTAGE"
    ? `${c.value / 100}% OFF${c.maxDiscount ? ` ≤ ${formatRupees(c.maxDiscount)}` : ""}`
    : `${formatRupees(c.value)} OFF`;
}

export function AdminCouponsScreen() {
  const qc = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const list = useQuery({
    queryKey: ["admin", "coupons", showInactive],
    queryFn: () => adminCouponsApi.list(showInactive),
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdminCoupon | null>(null);
  const [code, setCode] = useState("");
  const [desc, setDesc] = useState("");
  const [scope, setScope] = useState<CouponScope>("BOTH");
  const [type, setType] = useState<CouponType>("PERCENTAGE");
  const [value, setValue] = useState("");
  const [maxDisc, setMaxDisc] = useState("");
  const [minAmt, setMinAmt] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [perUser, setPerUser] = useState("1");
  const [isPublic, setIsPublic] = useState(true);
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
    setDesc("");
    setScope("BOTH");
    setType("PERCENTAGE");
    setValue("");
    setMaxDisc("");
    setMinAmt("");
    setMaxUses("");
    setPerUser("1");
    setIsPublic(true);
    setFrom(isoDate(new Date()));
    const d = new Date();
    d.setDate(d.getDate() + 30);
    setUntil(isoDate(d));
    setErr(null);
    setOpen(true);
  }
  function openEdit(c: AdminCoupon) {
    setEditing(c);
    setCode(c.code);
    setDesc(c.description ?? "");
    setScope(c.scope);
    setType(c.type);
    setValue(String(c.type === "PERCENTAGE" ? c.value / 100 : c.value));
    setMaxDisc(c.maxDiscount != null ? String(c.maxDiscount) : "");
    setMinAmt(c.minAmount != null ? String(c.minAmount) : "");
    setMaxUses(c.maxUses != null ? String(c.maxUses) : "");
    setPerUser(String(c.maxUsesPerUser));
    setIsPublic(c.isPublic);
    setFrom(c.validFrom.slice(0, 10));
    setUntil(c.validUntil.slice(0, 10));
    setErr(null);
    setOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const num = Number(value);
      if (!num || num <= 0) throw new Error("Enter a valid discount value");
      // PERCENTAGE → basis points (×100). FLAT → whole RUPEES (raw — the
      // canonical unit the web admin + coupon validator use; storing paise
      // here would 100x the discount). maxDiscount (% cap) is whole rupees.
      const storedValue =
        type === "PERCENTAGE" ? Math.round(num * 100) : Math.round(num);
      const maxDiscRupees = maxDisc ? Math.round(Number(maxDisc)) : undefined;
      const common = {
        description: desc.trim() || undefined,
        scope,
        value: storedValue,
        maxDiscount: type === "PERCENTAGE" ? maxDiscRupees ?? null : null,
        maxUses: maxUses ? Number(maxUses) : null,
        maxUsesPerUser: perUser ? Number(perUser) : 1,
        minAmount: minAmt ? Number(minAmt) : null,
        isPublic,
        validFrom: from,
        validUntil: until,
      };
      if (editing) {
        await adminCouponsApi.update(editing.id, common);
      } else {
        if (code.trim().length < 3) throw new Error("Code must be 3+ characters");
        await adminCouponsApi.create({ code: code.trim(), type, ...common });
      }
    },
    onSuccess: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["admin", "coupons"] });
    },
    onError: (e) =>
      setErr(e instanceof AdminApiError || e instanceof Error ? e.message : "Failed"),
  });

  const toggle = useMutation({
    mutationFn: (c: AdminCoupon) => adminCouponsApi.update(c.id, { isActive: !c.isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "coupons"] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => adminCouponsApi.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "coupons"] }),
  });

  const coupons = list.data?.coupons ?? [];

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
          <Pressable onPress={() => setShowInactive((v) => !v)} style={styles.inactiveToggle}>
            <Text variant="small" color={colors.zinc400}>
              {showInactive ? "Showing all" : "Active only"}
            </Text>
          </Pressable>
          <Button
            label="New coupon"
            onPress={openCreate}
            leadingIcon={<Plus size={16} color={colors.primaryForeground} />}
          />
        </View>

        {list.isLoading ? (
          <View style={styles.list}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} width="100%" height={70} />
            ))}
          </View>
        ) : coupons.length === 0 ? (
          <View style={styles.empty}>
            <Ticket size={34} color={colors.zinc600} />
            <Text variant="small" color={colors.zinc500} style={{ marginTop: spacing["2"] }}>
              No coupons yet.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {coupons.map((c) => (
              <Card key={c.id} style={styles.couponCard}>
                <Pressable onPress={() => openEdit(c)} style={{ flex: 1 }}>
                  <View style={styles.codeRow}>
                    <Ticket size={14} color={colors.emerald400} />
                    <Text variant="bodyStrong" color={colors.foreground}>
                      {c.code}
                    </Text>
                    <View style={styles.scopePill}>
                      <Text variant="tiny" color={colors.zinc400}>
                        {c.scope === "BOTH" ? "All" : c.scope === "SPORTS" ? "Bookings" : "Cafe"}
                      </Text>
                    </View>
                  </View>
                  <Text variant="small" color={colors.emerald400} style={{ marginTop: 2 }}>
                    {discountLabel(c)}
                  </Text>
                  <Text variant="tiny" color={colors.zinc500} style={{ marginTop: 1 }}>
                    {c.minAmount ? `Min ${formatRupees(c.minAmount)} · ` : ""}
                    {c.usedCount} used{c.maxUses ? `/${c.maxUses}` : ""} · till{" "}
                    {c.validUntil.slice(0, 10)}
                    {!c.isPublic ? " · hidden" : ""}
                  </Text>
                </Pressable>
                <View style={styles.actions}>
                  <Switch
                    value={c.isActive}
                    onValueChange={() => toggle.mutate(c)}
                    trackColor={{ true: colors.emerald500_10, false: colors.zinc700 }}
                    thumbColor={c.isActive ? colors.emerald400 : colors.zinc400}
                  />
                  <Pressable
                    hitSlop={8}
                    onPress={() =>
                      Alert.alert("Deactivate coupon?", `Disable ${c.code}?`, [
                        { text: "Cancel", style: "cancel" },
                        { text: "Deactivate", style: "destructive", onPress: () => remove.mutate(c.id) },
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
                {editing ? "Edit coupon" : "New coupon"}
              </Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                <X size={22} color={colors.zinc400} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody}>
              {!editing ? (
                <Input label="Code" autoCapitalize="characters" autoCorrect={false} placeholder="SAVE20" value={code} onChangeText={setCode} />
              ) : null}
              <Input label="Description (optional)" value={desc} onChangeText={setDesc} />

              <Text variant="tiny" color={colors.zinc500} style={styles.fieldLabel}>
                APPLIES TO
              </Text>
              <View style={styles.chipRow}>
                {SCOPES.map((s) => (
                  <Pressable key={s} onPress={() => setScope(s)} style={[styles.chip, scope === s && styles.chipActive]}>
                    <Text variant="small" weight="600" color={scope === s ? colors.emerald400 : colors.zinc400}>
                      {s === "BOTH" ? "All" : s === "SPORTS" ? "Bookings" : "Cafe"}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {!editing ? (
                <View style={styles.chipRow}>
                  {(["PERCENTAGE", "FLAT"] as CouponType[]).map((t) => (
                    <Pressable key={t} onPress={() => setType(t)} style={[styles.chip, type === t && styles.chipActive]}>
                      <Text variant="small" weight="600" color={type === t ? colors.emerald400 : colors.zinc400}>
                        {t === "PERCENTAGE" ? "Percentage" : "Flat ₹"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}>
                  <Input label={type === "PERCENTAGE" ? "Discount %" : "Discount ₹"} keyboardType="numeric" value={value} onChangeText={setValue} />
                </View>
                {type === "PERCENTAGE" ? (
                  <View style={{ flex: 1 }}>
                    <Input label="Max ₹ (cap)" keyboardType="numeric" value={maxDisc} onChangeText={setMaxDisc} />
                  </View>
                ) : (
                  <View style={{ flex: 1 }} />
                )}
              </View>
              <Input label="Min order ₹ (optional)" keyboardType="numeric" value={minAmt} onChangeText={setMinAmt} />
              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}>
                  <Input label="Max uses" keyboardType="numeric" placeholder="∞" value={maxUses} onChangeText={setMaxUses} />
                </View>
                <View style={{ flex: 1 }}>
                  <Input label="Per user" keyboardType="numeric" value={perUser} onChangeText={setPerUser} />
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
              <View style={styles.publicRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="small" weight="500" color={colors.foreground}>
                    Public
                  </Text>
                  <Text variant="tiny" color={colors.zinc500}>
                    Show on the customer coupons page
                  </Text>
                </View>
                <Switch
                  value={isPublic}
                  onValueChange={setIsPublic}
                  trackColor={{ true: colors.emerald500_10, false: colors.zinc700 }}
                  thumbColor={isPublic ? colors.emerald400 : colors.zinc400}
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
                label={editing ? "Save changes" : "Create coupon"}
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
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  inactiveToggle: {
    paddingVertical: spacing["2"],
    paddingHorizontal: spacing["3"],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc700,
  },
  list: { gap: spacing["3"] },
  couponCard: { padding: spacing["4"], flexDirection: "row", alignItems: "flex-start", gap: spacing["3"] },
  codeRow: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  scopePill: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.zinc800,
  },
  actions: { alignItems: "center", gap: spacing["2"] },
  empty: { alignItems: "center", paddingVertical: spacing["12"] },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: "92%",
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
  chipRow: { flexDirection: "row", gap: spacing["2"] },
  chip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  chipActive: { borderColor: colors.emerald400, backgroundColor: colors.emerald500_10 },
  twoCol: { flexDirection: "row", gap: spacing["3"] },
  publicRow: { flexDirection: "row", alignItems: "center", gap: spacing["3"], marginTop: spacing["1"] },
});
