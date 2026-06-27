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
  adminProductsApi,
  type AdminProduct,
} from "../../lib/admin-products";
import { formatRupees } from "../../lib/format";
import { AdminApiError } from "../../lib/admin-api";

export function AdminProductsScreen() {
  const qc = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const list = useQuery({
    queryKey: ["admin", "products", showInactive],
    queryFn: () => adminProductsApi.list(showInactive),
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [stock, setStock] = useState("");
  const [lowStock, setLowStock] = useState("3");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const categories = list.data?.categories ?? [];
  const products = list.data?.products ?? [];

  function openCreate() {
    setEditing(null);
    setName("");
    setDesc("");
    setPrice("");
    setCost("");
    setStock("0");
    setLowStock("3");
    setCategoryId(null);
    setErr(null);
    setOpen(true);
  }
  function openEdit(p: AdminProduct) {
    setEditing(p);
    setName(p.name);
    setDesc(p.description ?? "");
    setPrice(String(p.pricePaise / 100));
    setCost(String(p.costPaise / 100));
    setStock(String(p.stockQuantity));
    setLowStock(String(p.lowStockThreshold));
    setCategoryId(p.categoryId);
    setErr(null);
    setOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const priceNum = Number(price);
      if (!name.trim()) throw new Error("Name is required");
      if (!priceNum || priceNum <= 0) throw new Error("Enter a valid price");
      const pricePaise = Math.round(priceNum * 100);
      const costPaise = cost ? Math.round(Number(cost) * 100) : 0;
      const stockNum = Math.max(0, Math.trunc(Number(stock) || 0));
      const lowNum = Math.max(0, Math.trunc(Number(lowStock) || 0));
      if (editing) {
        await adminProductsApi.update(editing.id, {
          name: name.trim(),
          description: desc.trim() || null,
          pricePaise,
          costPaise,
          lowStockThreshold: lowNum,
          categoryId,
          stockDelta: stockNum - editing.stockQuantity,
        });
      } else {
        await adminProductsApi.create({
          name: name.trim(),
          description: desc.trim() || null,
          pricePaise,
          costPaise,
          stockQuantity: stockNum,
          lowStockThreshold: lowNum,
          categoryId,
        });
      }
    },
    onSuccess: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["admin", "products"] });
    },
    onError: (e) =>
      setErr(e instanceof AdminApiError || e instanceof Error ? e.message : "Failed"),
  });

  const toggle = useMutation({
    mutationFn: (p: AdminProduct) => adminProductsApi.update(p.id, { isActive: !p.isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "products"] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => adminProductsApi.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "products"] }),
  });

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
        ) : products.length === 0 ? (
          <View style={styles.empty}>
            <Package size={34} color={colors.zinc600} />
            <Text variant="small" color={colors.zinc500} style={{ marginTop: spacing["2"] }}>
              No products yet.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {products.map((p) => {
              const low = p.stockQuantity <= p.lowStockThreshold;
              return (
                <Card key={p.id} style={styles.row}>
                  <Pressable onPress={() => openEdit(p)} style={{ flex: 1 }}>
                    <Text variant="body" weight="500" color={colors.foreground}>
                      {p.name}
                    </Text>
                    <Text variant="tiny" color={colors.zinc500}>
                      {formatRupees(p.pricePaise / 100)} ·{" "}
                      <Text variant="tiny" color={low ? colors.warning : colors.zinc500}>
                        {p.stockQuantity} in stock
                      </Text>
                      {p.category ? ` · ${p.category.name}` : ""}
                    </Text>
                  </Pressable>
                  <View style={styles.actions}>
                    <Switch
                      value={p.isActive}
                      onValueChange={() => toggle.mutate(p)}
                      trackColor={{ true: colors.emerald500_10, false: colors.zinc700 }}
                      thumbColor={p.isActive ? colors.emerald400 : colors.zinc400}
                    />
                    <Pressable
                      hitSlop={8}
                      onPress={() =>
                        Alert.alert("Delete product?", `Remove ${p.name}?`, [
                          { text: "Cancel", style: "cancel" },
                          { text: "Delete", style: "destructive", onPress: () => remove.mutate(p.id) },
                        ])
                      }
                    >
                      <Trash2 size={16} color={colors.destructive} />
                    </Pressable>
                  </View>
                </Card>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text variant="title" weight="700">
                {editing ? "Edit product" : "New product"}
              </Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                <X size={22} color={colors.zinc400} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody}>
              <Input label="Name" value={name} onChangeText={setName} />
              <Input label="Description (optional)" value={desc} onChangeText={setDesc} multiline />
              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}>
                  <Input label="Price ₹" keyboardType="numeric" value={price} onChangeText={setPrice} />
                </View>
                <View style={{ flex: 1 }}>
                  <Input label="Cost ₹ (optional)" keyboardType="numeric" value={cost} onChangeText={setCost} />
                </View>
              </View>
              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}>
                  <Input label="Stock" keyboardType="numeric" value={stock} onChangeText={setStock} />
                </View>
                <View style={{ flex: 1 }}>
                  <Input label="Low-stock at" keyboardType="numeric" value={lowStock} onChangeText={setLowStock} />
                </View>
              </View>

              {categories.length > 0 ? (
                <>
                  <Text variant="tiny" color={colors.zinc500} style={styles.fieldLabel}>
                    CATEGORY
                  </Text>
                  <View style={styles.catRow}>
                    <Pressable
                      onPress={() => setCategoryId(null)}
                      style={[styles.catChip, categoryId === null && styles.catChipActive]}
                    >
                      <Text variant="tiny" weight="600" color={categoryId === null ? colors.emerald400 : colors.zinc400}>
                        None
                      </Text>
                    </Pressable>
                    {categories.map((c) => (
                      <Pressable
                        key={c.id}
                        onPress={() => setCategoryId(c.id)}
                        style={[styles.catChip, categoryId === c.id && styles.catChipActive]}
                      >
                        <Text variant="tiny" weight="600" color={categoryId === c.id ? colors.emerald400 : colors.zinc400}>
                          {c.name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}

              {err ? (
                <Text variant="small" color={colors.destructive} style={{ marginTop: spacing["2"] }}>
                  {err}
                </Text>
              ) : null}
            </ScrollView>
            <View style={styles.modalFooter}>
              <Button
                label={editing ? "Save changes" : "Create product"}
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
  row: { flexDirection: "row", alignItems: "center", gap: spacing["3"], padding: spacing["4"] },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing["3"] },
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
  twoCol: { flexDirection: "row", gap: spacing["3"] },
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
