import { useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Eye,
  EyeOff,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
  UtensilsCrossed,
  X,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Badge } from "../../components/ui/Badge";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminCafeApi,
  type CafeItem,
  type CafeItemCategory,
  type CafeItemInput,
} from "../../lib/admin-cafe";
import { AdminApiError } from "../../lib/admin-api";
import { categoryLabel, formatRupees } from "../../lib/format";

const CATEGORY_FILTERS: { value: CafeItemCategory | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "SNACKS", label: "Snacks" },
  { value: "BEVERAGES", label: "Beverages" },
  { value: "MEALS", label: "Meals" },
  { value: "DESSERTS", label: "Desserts" },
  { value: "COMBOS", label: "Combos" },
];

// Category options for the add/edit form (no "All" pseudo-option).
const FORM_CATEGORIES: CafeItemCategory[] = [
  "SNACKS",
  "BEVERAGES",
  "MEALS",
  "DESSERTS",
  "COMBOS",
];

// Fulfilment kind — mirrors the web form. PREP = kitchen item routed
// through the PENDING→PREPARING→READY→COMPLETED kanban with no stock
// counter (quantity persists as null); READY = counter item with a
// finite on-hand stock count (quantity is an integer).
type Fulfilment = "PREP" | "READY";

/**
 * Full-parity port of the web /admin/cafe-menu page:
 *   - master "Open for orders" toggle (CafeSettings.isOpen)
 *   - add / edit item (name, price, cost, category, PREP/READY +
 *     stock, description, tags, veg)
 *   - delete (soft, via confirm)
 *   - per-item availability toggle (optimistic, preserved as-is)
 *
 * Optimistic availability toggle: we flip the local `isAvailable`
 * flag immediately and roll back if the server rejects.
 */
export function AdminCafeMenuScreen() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CafeItemCategory | "">("");

  const itemsKey = ["admin-cafe-items", category || "ALL"] as const;

  const items = useQuery({
    queryKey: itemsKey,
    queryFn: () =>
      adminCafeApi.items({
        category: category === "" ? undefined : category,
        showUnavailable: true,
      }),
    refetchOnWindowFocus: false,
  });

  // ─── Master open/closed toggle ───────────────────────────────
  const openState = useQuery({
    queryKey: ["admin-cafe-open"],
    queryFn: () => adminCafeApi.getOpen(),
    refetchOnWindowFocus: false,
  });

  const setOpen = useMutation({
    mutationFn: (next: boolean) => adminCafeApi.setOpen(next),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: ["admin-cafe-open"] });
      const prev = qc.getQueryData<{ isOpen: boolean }>(["admin-cafe-open"]);
      qc.setQueryData(["admin-cafe-open"], { isOpen: next });
      return { prev };
    },
    onError: (err, _next, ctx) => {
      if (ctx?.prev) qc.setQueryData(["admin-cafe-open"], ctx.prev);
      Alert.alert(
        "Couldn't update",
        err instanceof AdminApiError ? err.message : "Try again.",
      );
    },
    onSettled: () =>
      void qc.invalidateQueries({ queryKey: ["admin-cafe-open"] }),
  });

  // ─── Per-item availability toggle (preserved) ────────────────
  const toggle = useMutation({
    mutationFn: (id: string) => adminCafeApi.toggleAvailability(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: itemsKey });
      const prev = qc.getQueryData<{
        items: CafeItem[];
        grouped: Record<string, CafeItem[]>;
      }>(itemsKey);
      if (prev) {
        qc.setQueryData(itemsKey, {
          ...prev,
          items: prev.items.map((it) =>
            it.id === id ? { ...it, isAvailable: !it.isAvailable } : it,
          ),
        });
      }
      return { prev };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(itemsKey, ctx.prev);
      Alert.alert(
        "Couldn't toggle",
        err instanceof AdminApiError ? err.message : "Try again.",
      );
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: itemsKey }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminCafeApi.removeItem(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: itemsKey }),
    onError: (err) =>
      Alert.alert(
        "Couldn't remove",
        err instanceof AdminApiError ? err.message : "Try again.",
      ),
  });

  // ─── Add / edit form state ───────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CafeItem | null>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [formCategory, setFormCategory] = useState<CafeItemCategory>("SNACKS");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [fulfilment, setFulfilment] = useState<Fulfilment>("PREP");
  const [stock, setStock] = useState("");
  const [tags, setTags] = useState("");
  const [isVeg, setIsVeg] = useState(true);
  const [formErr, setFormErr] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setName("");
    setDesc("");
    setFormCategory(category === "" ? "SNACKS" : category);
    setPrice("");
    setCost("");
    setFulfilment("PREP");
    setStock("");
    setTags("");
    setIsVeg(true);
    setFormErr(null);
    setFormOpen(true);
  }

  function openEdit(it: CafeItem) {
    setEditing(it);
    setName(it.name);
    setDesc(it.description ?? "");
    setFormCategory(it.category);
    setPrice(String(it.price));
    setCost(it.costPrice != null ? String(it.costPrice) : "");
    setFulfilment(it.quantity != null ? "READY" : "PREP");
    setStock(it.quantity != null ? String(it.quantity) : "");
    setTags(it.tags.join(", "));
    setIsVeg(it.isVeg);
    setFormErr(null);
    setFormOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const priceNum = parseFloat(price);
      if (!name.trim()) throw new Error("Item name is required");
      if (!Number.isFinite(priceNum) || priceNum <= 0) {
        throw new Error("Price must be a positive number");
      }

      // Cost price optional; if set, must be >= 0 and not exceed price.
      let costVal: number | null = null;
      const costRaw = cost.trim();
      if (costRaw !== "") {
        const parsed = parseFloat(costRaw);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error("Cost price must be a non-negative number");
        }
        if (parsed > priceNum) {
          throw new Error(
            "Cost price is higher than selling price — double-check the figures",
          );
        }
        costVal = parsed;
      }

      // Quantity routing follows the fulfilment chip — PREP always
      // persists null (kitchen item, no stock cap); READY needs a
      // non-negative integer (0 = currently out of stock).
      let quantityVal: number | null = null;
      if (fulfilment === "READY") {
        const qtyRaw = stock.trim();
        if (qtyRaw === "") {
          throw new Error(
            "Ready-to-serve items need a stock count. Enter 0 if out of stock.",
          );
        }
        const parsed = Number(qtyRaw);
        if (!Number.isInteger(parsed) || parsed < 0) {
          throw new Error("Stock quantity must be a non-negative whole number");
        }
        quantityVal = parsed;
      }

      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const payload: CafeItemInput = {
        name: name.trim(),
        description: desc.trim() || null,
        category: formCategory,
        price: priceNum,
        costPrice: costVal,
        quantity: quantityVal,
        isVeg,
        tags: tagList,
      };

      if (editing) {
        await adminCafeApi.updateItem(editing.id, payload);
      } else {
        await adminCafeApi.createItem(payload);
      }
    },
    onSuccess: () => {
      setFormOpen(false);
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ["admin-cafe-items"] });
    },
    onError: (e) =>
      setFormErr(
        e instanceof AdminApiError || e instanceof Error ? e.message : "Failed",
      ),
  });

  function confirmDelete(it: CafeItem) {
    Alert.alert(
      "Mark unavailable?",
      `"${it.name}" will be hidden from the cafe menu. You can re-enable it from the availability toggle.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Mark unavailable",
          style: "destructive",
          onPress: () => remove.mutate(it.id),
        },
      ],
    );
  }

  const filtered = useMemo(() => {
    const all = items.data?.items ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        (it.description ?? "").toLowerCase().includes(q) ||
        it.tags.join(" ").toLowerCase().includes(q),
    );
  }, [items.data, search]);

  const refreshing =
    (items.isFetching && !items.isLoading) || items.isRefetching;

  const open = openState.data?.isOpen ?? true;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void items.refetch();
              void openState.refetch();
            }}
            tintColor={colors.yellow400}
          />
        }
      >
        {/* Master "Open for orders" toggle */}
        <Card style={styles.openCard}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              variant="bodyStrong"
              color={open ? colors.emerald400 : colors.zinc400}
            >
              {open ? "Open for orders" : "Closed"}
            </Text>
            <Text variant="tiny" color={colors.zinc500}>
              {open
                ? "Customers can place orders from /cafe."
                : "Customers see the closed page. Admin walk-ins still work."}
            </Text>
          </View>
          <Switch
            value={open}
            onValueChange={(next) => setOpen.mutate(next)}
            disabled={openState.isLoading || setOpen.isPending}
            trackColor={{ true: colors.emerald500_30, false: colors.zinc700 }}
            thumbColor={open ? colors.emerald400 : colors.zinc400}
          />
        </Card>

        {/* Search + Add */}
        <View style={styles.searchRow}>
          <Search size={14} color={colors.zinc500} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search menu items"
            placeholderTextColor={colors.zinc600}
            style={styles.searchInput}
          />
        </View>

        <View style={styles.actionsRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
            style={{ flex: 1 }}
          >
            {CATEGORY_FILTERS.map((c) => {
              const active = category === c.value;
              return (
                <Pressable
                  key={c.value || "ALL"}
                  onPress={() => setCategory(c.value)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text
                    variant="tiny"
                    color={active ? colors.yellow400 : colors.zinc300}
                    weight="600"
                  >
                    {c.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Button
            label="Add"
            onPress={openCreate}
            leadingIcon={<Plus size={16} color={colors.primaryForeground} />}
          />
        </View>

        {items.isLoading ? (
          <ListSkeleton />
        ) : items.isError ? (
          <Pressable
            onPress={() => void items.refetch()}
            style={styles.errorBlock}
          >
            <Text variant="body" color={colors.destructive}>
              Couldn't load menu. Tap to retry.
            </Text>
            <Text variant="tiny" color={colors.zinc500}>
              {items.error instanceof Error
                ? items.error.message
                : "Unknown error"}
            </Text>
          </Pressable>
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text variant="bodyStrong" color={colors.zinc300}>
              No items
            </Text>
            <Text variant="tiny" color={colors.zinc500} align="center">
              Try a different search or category, or add a new item.
            </Text>
          </View>
        ) : (
          <View style={{ gap: spacing["2"] }}>
            {filtered.map((it) => (
              <ItemRow
                key={it.id}
                item={it}
                onToggle={() => toggle.mutate(it.id)}
                isToggling={toggle.isPending && toggle.variables === it.id}
                onEdit={() => openEdit(it)}
                onDelete={() => confirmDelete(it)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* Add / edit modal */}
      <Modal
        visible={formOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setFormOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text variant="title" weight="700">
                {editing ? "Edit item" : "New menu item"}
              </Text>
              <Pressable onPress={() => setFormOpen(false)} hitSlop={8}>
                <X size={22} color={colors.zinc400} />
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.modalBody}
              keyboardShouldPersistTaps="handled"
            >
              <Input
                label="Item name"
                value={name}
                onChangeText={setName}
                placeholder="e.g. Cold Coffee"
              />

              <Text variant="tiny" color={colors.zinc500} style={styles.fieldLabel}>
                CATEGORY
              </Text>
              <View style={styles.catRow}>
                {FORM_CATEGORIES.map((c) => {
                  const active = formCategory === c;
                  return (
                    <Pressable
                      key={c}
                      onPress={() => setFormCategory(c)}
                      style={[styles.catChip, active && styles.catChipActive]}
                    >
                      <Text
                        variant="tiny"
                        weight="600"
                        color={active ? colors.emerald400 : colors.zinc400}
                      >
                        {categoryLabel(c)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}>
                  <Input
                    label="Selling price ₹"
                    keyboardType="decimal-pad"
                    value={price}
                    onChangeText={setPrice}
                    placeholder="e.g. 150"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Input
                    label="Cost price ₹ (optional)"
                    keyboardType="decimal-pad"
                    value={cost}
                    onChangeText={setCost}
                    placeholder="To source"
                  />
                </View>
              </View>

              {/* Fulfilment — PREP (kitchen) vs READY (stock-tracked) */}
              <Text variant="tiny" color={colors.zinc500} style={styles.fieldLabel}>
                FULFILMENT
              </Text>
              <View style={styles.fulfilRow}>
                <Pressable
                  onPress={() => {
                    setFulfilment("PREP");
                    setStock("");
                  }}
                  style={[
                    styles.fulfilChip,
                    fulfilment === "PREP" && styles.fulfilChipPrep,
                  ]}
                >
                  <UtensilsCrossed
                    size={14}
                    color={fulfilment === "PREP" ? colors.warning : colors.zinc400}
                  />
                  <Text
                    variant="tiny"
                    weight="600"
                    color={fulfilment === "PREP" ? colors.warning : colors.zinc400}
                  >
                    Cooked to order
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setFulfilment("READY")}
                  style={[
                    styles.fulfilChip,
                    fulfilment === "READY" && styles.fulfilChipReady,
                  ]}
                >
                  <Package
                    size={14}
                    color={fulfilment === "READY" ? colors.emerald400 : colors.zinc400}
                  />
                  <Text
                    variant="tiny"
                    weight="600"
                    color={fulfilment === "READY" ? colors.emerald400 : colors.zinc400}
                  >
                    Ready to serve
                  </Text>
                </Pressable>
              </View>
              {fulfilment === "READY" ? (
                <Input
                  label="Stock on hand"
                  keyboardType="number-pad"
                  value={stock}
                  onChangeText={setStock}
                  placeholder="e.g. 24"
                  hint="Decrements on each order. Set 0 for out-of-stock."
                />
              ) : (
                <Text variant="tiny" color={colors.zinc500}>
                  No stock counter — every order goes through the kitchen
                  pipeline (PENDING → PREPARING → READY → COMPLETED).
                </Text>
              )}

              <Input
                label="Description (optional)"
                value={desc}
                onChangeText={setDesc}
                placeholder="Short menu description (e.g. 200 ml)"
                multiline
              />
              <Input
                label="Tags (comma separated)"
                value={tags}
                onChangeText={setTags}
                placeholder="Bestseller, Spicy"
              />

              <View style={styles.vegRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="body" color={colors.foreground} weight="500">
                    {isVeg ? "Vegetarian" : "Non-Vegetarian"}
                  </Text>
                  <Text variant="tiny" color={colors.zinc500}>
                    Shown as a veg / non-veg marker on the menu.
                  </Text>
                </View>
                <Switch
                  value={isVeg}
                  onValueChange={setIsVeg}
                  trackColor={{ true: colors.emerald500_30, false: colors.destructive_30 }}
                  thumbColor={isVeg ? colors.emerald400 : colors.destructive_300}
                />
              </View>

              {formErr ? (
                <Text
                  variant="small"
                  color={colors.destructive}
                  style={{ marginTop: spacing["2"] }}
                >
                  {formErr}
                </Text>
              ) : null}
            </ScrollView>
            <View style={styles.modalFooter}>
              {editing ? (
                <Button
                  label="Mark unavailable"
                  variant="destructive"
                  onPress={() => {
                    setFormOpen(false);
                    confirmDelete(editing);
                  }}
                  style={{ marginBottom: spacing["3"] }}
                  fullWidth
                />
              ) : null}
              <Button
                label={editing ? "Save changes" : "Create item"}
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

function ItemRow({
  item,
  onToggle,
  isToggling,
  onEdit,
  onDelete,
}: {
  item: CafeItem;
  onToggle: () => void;
  isToggling: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const dim = !item.isAvailable;
  return (
    <View
      style={[
        styles.row,
        dim && {
          opacity: 0.6,
          borderStyle: "dashed",
        },
      ]}
    >
      <Pressable onPress={onEdit} style={{ flex: 1, gap: 2 }} hitSlop={4}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {item.isVeg ? "🥬" : "🍗"} {item.name}
          </Text>
          {item.quantity != null ? (
            <Badge label="Ready" tone="success" />
          ) : (
            <Badge label="Prep" tone="warning" />
          )}
        </View>
        {item.description ? (
          <Text variant="tiny" color={colors.zinc500} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        <View style={styles.rowMeta}>
          <Text variant="tiny" color={colors.yellow400} weight="600">
            {formatRupees(item.price)}
          </Text>
          <Text variant="tiny" color={colors.zinc600}>
            ·
          </Text>
          <Text variant="tiny" color={colors.zinc500}>
            {categoryLabel(item.category)}
          </Text>
        </View>
        {/* Stock indicator — mirrors the web card. */}
        {item.quantity === null ? (
          <Text variant="tiny" color={colors.zinc500}>
            Kitchen item · no stock tracking
          </Text>
        ) : item.quantity === 0 ? (
          <Text variant="tiny" color={colors.destructive} weight="600">
            Out of stock
          </Text>
        ) : item.quantity <= 3 ? (
          <Text variant="tiny" color={colors.warning} weight="600">
            {item.quantity} left — restock soon
          </Text>
        ) : (
          <Text variant="tiny" color={colors.zinc500}>
            {item.quantity} in stock
          </Text>
        )}
      </Pressable>
      <View style={styles.rowActions}>
        <Pressable onPress={onEdit} hitSlop={8} style={styles.iconBtn}>
          <Pencil size={16} color={colors.zinc400} />
        </Pressable>
        <Pressable
          onPress={onToggle}
          disabled={isToggling}
          hitSlop={8}
          style={({ pressed }) => [
            styles.toggleBtn,
            item.isAvailable ? styles.toggleOn : styles.toggleOff,
            isToggling && { opacity: 0.5 },
            pressed && { opacity: 0.7 },
          ]}
        >
          {item.isAvailable ? (
            <Eye size={14} color={colors.emerald400} />
          ) : (
            <EyeOff size={14} color={colors.zinc400} />
          )}
          <Text
            variant="tiny"
            color={item.isAvailable ? colors.emerald400 : colors.zinc400}
            weight="600"
          >
            {item.isAvailable ? "Live" : "Hidden"}
          </Text>
        </Pressable>
        <Pressable onPress={onDelete} hitSlop={8} style={styles.iconBtn}>
          <Trash2 size={16} color={colors.destructive} />
        </Pressable>
      </View>
    </View>
  );
}

function ListSkeleton() {
  return (
    <View style={{ gap: spacing["2"] }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={styles.row}>
          <View style={{ flex: 1, gap: 4 }}>
            <Skeleton width="50%" height={14} />
            <Skeleton width="80%" height={11} />
            <Skeleton width="30%" height={11} />
          </View>
          <Skeleton width={64} height={28} rounded="full" />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  openCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    padding: spacing["4"],
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    borderWidth: 1,
    borderColor: colors.zinc800,
    borderRadius: 8,
    paddingHorizontal: spacing["3"],
    backgroundColor: colors.zinc900,
  },
  searchInput: {
    flex: 1,
    paddingVertical: spacing["2.5"],
    color: colors.foreground,
    fontSize: 14,
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  chipRow: {
    flexDirection: "row",
    gap: spacing["2"],
    paddingVertical: spacing["1"],
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
    borderColor: "rgba(250, 204, 21, 0.40)",
    backgroundColor: "rgba(250, 204, 21, 0.10)",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    padding: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  rowMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
  },
  rowActions: {
    alignItems: "center",
    gap: spacing["2"],
  },
  iconBtn: {
    padding: spacing["1"],
  },
  toggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing["2.5"],
    paddingVertical: spacing["1.5"],
    borderRadius: 999,
    borderWidth: 1,
  },
  toggleOn: {
    borderColor: "rgba(34, 197, 94, 0.30)",
    backgroundColor: "rgba(34, 197, 94, 0.10)",
  },
  toggleOff: {
    borderColor: colors.zinc800,
    backgroundColor: colors.background,
  },
  empty: {
    alignItems: "center",
    gap: spacing["1"],
    padding: spacing["6"],
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  errorBlock: {
    padding: spacing["4"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.30)",
    backgroundColor: "rgba(239, 68, 68, 0.10)",
    gap: spacing["1"],
  },
  // Modal
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
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
  fieldLabel: {
    letterSpacing: 1.2,
    fontWeight: "700",
    marginTop: spacing["1"],
  },
  twoCol: { flexDirection: "row", gap: spacing["3"] },
  catRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing["2"] },
  catChip: {
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  catChipActive: {
    borderColor: colors.emerald400,
    backgroundColor: colors.emerald500_10,
  },
  fulfilRow: { flexDirection: "row", gap: spacing["2"] },
  fulfilChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  fulfilChipPrep: {
    borderColor: "rgba(245, 158, 11, 0.50)",
    backgroundColor: colors.warningSoft,
  },
  fulfilChipReady: {
    borderColor: colors.emerald400_50,
    backgroundColor: colors.emerald500_10,
  },
  vegRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    marginTop: spacing["1"],
  },
});
