import { useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Minus, Plus } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { CafeThumb } from "../../components/admin/CafeThumb";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import { adminCafeApi } from "../../lib/admin-cafe";
import { AdminApiError } from "../../lib/admin-api";
import { formatRupees } from "../../lib/format";
import type { CafeItem } from "../../lib/admin-cafe";
import type { AdminCafeStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<
  AdminCafeStackParamList,
  "AdminCafeCreateOrder"
>;
type PayMode = "CASH" | "UPI_QR" | "SPLIT";

export function AdminCafeCreateOrderScreen() {
  const navigation = useNavigation<Nav>();
  const menu = useQuery({
    queryKey: ["admin", "cafe-items", "create-order"],
    queryFn: () => adminCafeApi.items({ showUnavailable: false }),
  });

  const [cart, setCart] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [discount, setDiscount] = useState("");
  const [note, setNote] = useState("");
  const [payMode, setPayMode] = useState<PayMode>("CASH");
  const [splitCash, setSplitCash] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const items = menu.data?.items ?? [];
  const itemById = useMemo(
    () => new Map(items.map((i) => [i.id, i])),
    [items],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
  }, [items, search]);

  const subtotal = useMemo(
    () =>
      Object.entries(cart).reduce((sum, [id, qty]) => {
        const it = itemById.get(id);
        return sum + (it ? it.price * qty : 0);
      }, 0),
    [cart, itemById],
  );
  const discountNum = Math.max(0, Number(discount) || 0);
  const total = Math.max(0, subtotal - discountNum);
  const lineCount = Object.values(cart).reduce((a, b) => a + b, 0);

  function setQty(item: CafeItem, qty: number) {
    setCart((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[item.id];
      else next[item.id] = qty;
      return next;
    });
  }

  const create = useMutation({
    mutationFn: async () => {
      const orderItems = Object.entries(cart).map(([cafeItemId, quantity]) => ({
        cafeItemId,
        quantity,
      }));
      if (orderItems.length === 0) throw new Error("Add at least one item");

      let split: { cashAmount: number; upiAmount: number } | undefined;
      if (payMode === "SPLIT") {
        const cash = Math.max(0, Number(splitCash) || 0);
        const upi = Math.round((total - cash) * 100) / 100;
        if (upi < 0) throw new Error("Cash portion exceeds the total");
        split = { cashAmount: cash, upiAmount: upi };
      }

      return adminCafeApi.createOrder({
        items: orderItems,
        customerPhone: phone.trim() || undefined,
        customerName: name.trim() || undefined,
        discountAmount: discountNum || undefined,
        paymentMethod: payMode === "SPLIT" ? "CASH" : payMode,
        split,
        note: note.trim() || undefined,
      });
    },
    onSuccess: (res) => {
      Alert.alert("Order created", `Order ${res.orderNumber} placed.`);
      navigation.navigate("AdminCafeOrders");
    },
    onError: (e) =>
      setErr(
        e instanceof AdminApiError || e instanceof Error
          ? e.message
          : "Failed to create order",
      ),
  });

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Input
          placeholder="Search items"
          value={search}
          onChangeText={setSearch}
        />

        {menu.isLoading ? (
          <View style={styles.list}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} width="100%" height={52} />
            ))}
          </View>
        ) : (
          <View style={styles.list}>
            {filtered.map((it) => {
              const qty = cart[it.id] ?? 0;
              const soldOut = it.quantity === 0;
              return (
                <Card key={it.id} style={styles.itemRow}>
                  <CafeThumb uri={it.image} isVeg={it.isVeg} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text variant="body" weight="500" color={colors.foreground}>
                      {it.name}
                    </Text>
                    <Text variant="tiny" color={colors.zinc500}>
                      {formatRupees(it.price)}
                      {it.quantity != null ? ` · ${it.quantity} left` : ""}
                    </Text>
                  </View>
                  {soldOut ? (
                    <Text variant="tiny" color={colors.destructive}>
                      Sold out
                    </Text>
                  ) : qty === 0 ? (
                    <Pressable
                      onPress={() => setQty(it, 1)}
                      style={styles.addBtn}
                      hitSlop={6}
                    >
                      <Plus size={16} color={colors.emerald400} />
                    </Pressable>
                  ) : (
                    <View style={styles.stepper}>
                      <Pressable onPress={() => setQty(it, qty - 1)} hitSlop={6}>
                        <Minus size={16} color={colors.zinc300} />
                      </Pressable>
                      <Text variant="body" weight="600" color={colors.foreground}>
                        {qty}
                      </Text>
                      <Pressable
                        onPress={() =>
                          setQty(
                            it,
                            it.quantity != null
                              ? Math.min(qty + 1, it.quantity)
                              : qty + 1,
                          )
                        }
                        hitSlop={6}
                      >
                        <Plus size={16} color={colors.emerald400} />
                      </Pressable>
                    </View>
                  )}
                </Card>
              );
            })}
          </View>
        )}

        {/* Customer */}
        <Text variant="tiny" color={colors.zinc500} style={styles.sectionLabel}>
          CUSTOMER (OPTIONAL)
        </Text>
        <View style={styles.twoCol}>
          <View style={{ flex: 1 }}>
            <Input
              placeholder="Phone"
              keyboardType="number-pad"
              maxLength={10}
              value={phone}
              onChangeText={setPhone}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input placeholder="Name" value={name} onChangeText={setName} />
          </View>
        </View>

        {/* Discount + note */}
        <Input
          label="Discount ₹ (optional)"
          keyboardType="numeric"
          value={discount}
          onChangeText={setDiscount}
        />
        <Input
          label="Note (optional)"
          placeholder="Any kitchen note"
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={500}
        />

        {/* Payment */}
        <Text variant="tiny" color={colors.zinc500} style={styles.sectionLabel}>
          PAYMENT
        </Text>
        <View style={styles.payRow}>
          {(["CASH", "UPI_QR", "SPLIT"] as PayMode[]).map((m) => (
            <Pressable
              key={m}
              onPress={() => setPayMode(m)}
              style={[styles.payChip, payMode === m && styles.payChipActive]}
            >
              <Text
                variant="small"
                weight="600"
                color={payMode === m ? colors.emerald400 : colors.zinc400}
              >
                {m === "UPI_QR" ? "UPI" : m === "SPLIT" ? "Split" : "Cash"}
              </Text>
            </Pressable>
          ))}
        </View>
        {payMode === "SPLIT" ? (
          <View style={styles.twoCol}>
            <View style={{ flex: 1 }}>
              <Input
                label="Cash ₹"
                keyboardType="numeric"
                value={splitCash}
                onChangeText={setSplitCash}
              />
            </View>
            <View style={{ flex: 1, justifyContent: "flex-end" }}>
              <Text variant="tiny" color={colors.zinc500}>
                UPI ₹{Math.max(0, total - (Number(splitCash) || 0))}
              </Text>
            </View>
          </View>
        ) : null}

        {err ? (
          <Text variant="small" color={colors.destructive} style={{ marginTop: spacing["2"] }}>
            {err}
          </Text>
        ) : null}
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <View style={styles.totalRow}>
          <Text variant="small" color={colors.zinc400}>
            {lineCount} item{lineCount === 1 ? "" : "s"}
            {discountNum > 0 ? ` · −${formatRupees(discountNum)}` : ""}
          </Text>
          <Text variant="heading" weight="700" color={colors.emerald400}>
            {formatRupees(total)}
          </Text>
        </View>
        <Button
          label="Create order"
          onPress={() => {
            setErr(null);
            create.mutate();
          }}
          loading={create.isPending}
          disabled={lineCount === 0}
          fullWidth
          size="lg"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["6"],
    gap: spacing["3"],
  },
  list: { gap: spacing["2"] },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    padding: spacing["3"],
  },
  addBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.emerald400,
    backgroundColor: colors.emerald500_10,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  sectionLabel: {
    letterSpacing: 1.2,
    fontWeight: "700",
    marginTop: spacing["2"],
  },
  twoCol: { flexDirection: "row", gap: spacing["3"] },
  payRow: { flexDirection: "row", gap: spacing["2"] },
  payChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  payChipActive: {
    borderColor: colors.emerald400,
    backgroundColor: colors.emerald500_10,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["6"],
    backgroundColor: colors.background,
    gap: spacing["3"],
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
