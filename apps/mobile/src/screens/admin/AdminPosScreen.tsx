import { useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Minus, Plus } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import { adminPosApi, type PosProduct } from "../../lib/admin-pos";
import { AdminApiError } from "../../lib/admin-api";
import { formatRupees } from "../../lib/format";

type PayMode = "CASH" | "UPI_QR";

/** Paise → ₹ — the shop domain stores money in paise. */
function rupees(paise: number): string {
  return formatRupees(Math.round(paise / 100));
}

/**
 * Mobile mirror of the web /admin/pos walk-in sale. Product picker with
 * +/- steppers, a required customer (phone + name, resolved server-side,
 * idempotent on phone), payment method (Cash / UPI QR) + "already paid"
 * toggle, then "Create sale" → placeAdminOrder. Money is in PAISE.
 */
export function AdminPosScreen() {
  const list = useQuery({
    queryKey: ["admin", "pos-products"],
    queryFn: () => adminPosApi.products(),
  });

  const [bill, setBill] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [payMode, setPayMode] = useState<PayMode>("CASH");
  const [markPaid, setMarkPaid] = useState(true);
  const [utr, setUtr] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const products = list.data?.products ?? [];
  const byId = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products;
  }, [products, search]);

  const totalPaise = useMemo(
    () =>
      Object.entries(bill).reduce((sum, [id, qty]) => {
        const p = byId.get(id);
        return sum + (p ? p.pricePaise * qty : 0);
      }, 0),
    [bill, byId],
  );
  const lineCount = Object.values(bill).reduce((a, b) => a + b, 0);

  function setQty(product: PosProduct, qty: number) {
    setBill((prev) => {
      const next = { ...prev };
      const clamped = Math.max(0, Math.min(product.stockQuantity, qty));
      if (clamped <= 0) delete next[product.id];
      else next[product.id] = clamped;
      return next;
    });
  }

  const create = useMutation({
    mutationFn: async () => {
      const items = Object.entries(bill).map(([productId, quantity]) => ({
        productId,
        quantity,
      }));
      if (items.length === 0) throw new Error("Add at least one item");
      if (!phone.trim() || !name.trim()) {
        throw new Error("Customer name and phone are required");
      }
      return adminPosApi.createSale({
        items,
        customerPhone: phone.trim(),
        customerName: name.trim(),
        method: payMode,
        markPaid,
        utrNumber:
          payMode === "UPI_QR" && utr.trim() ? utr.trim() : undefined,
      });
    },
    onSuccess: (res) => {
      Alert.alert("Sale created", `Order ${res.orderNumber} placed.`);
      setBill({});
      setPhone("");
      setName("");
      setUtr("");
      setErr(null);
    },
    onError: (e) =>
      setErr(
        e instanceof AdminApiError || e instanceof Error
          ? e.message
          : "Failed to create sale",
      ),
  });

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Input
          placeholder="Search products"
          value={search}
          onChangeText={setSearch}
        />

        {list.isLoading ? (
          <View style={styles.list}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} width="100%" height={52} />
            ))}
          </View>
        ) : products.length === 0 ? (
          <Text variant="small" color={colors.zinc500}>
            No in-stock items. Restock via Products first.
          </Text>
        ) : (
          <View style={styles.list}>
            {filtered.map((p) => {
              const qty = bill[p.id] ?? 0;
              const reachedMax = qty >= p.stockQuantity;
              return (
                <Card key={p.id} style={styles.itemRow}>
                  <View style={{ flex: 1 }}>
                    <Text variant="body" weight="500" color={colors.foreground}>
                      {p.name}
                    </Text>
                    <Text variant="tiny" color={colors.zinc500}>
                      {rupees(p.pricePaise)} · {p.stockQuantity} left
                    </Text>
                  </View>
                  {qty === 0 ? (
                    <Pressable
                      onPress={() => setQty(p, 1)}
                      style={styles.addBtn}
                      hitSlop={6}
                    >
                      <Plus size={16} color={colors.emerald400} />
                    </Pressable>
                  ) : (
                    <View style={styles.stepper}>
                      <Pressable onPress={() => setQty(p, qty - 1)} hitSlop={6}>
                        <Minus size={16} color={colors.zinc300} />
                      </Pressable>
                      <Text variant="body" weight="600" color={colors.foreground}>
                        {qty}
                      </Text>
                      <Pressable
                        onPress={() => setQty(p, qty + 1)}
                        hitSlop={6}
                        disabled={reachedMax}
                        style={reachedMax ? { opacity: 0.4 } : undefined}
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
          CUSTOMER (REQUIRED)
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

        {/* Payment */}
        <Text variant="tiny" color={colors.zinc500} style={styles.sectionLabel}>
          PAYMENT
        </Text>
        <View style={styles.payRow}>
          {(["CASH", "UPI_QR"] as PayMode[]).map((m) => (
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
                {m === "UPI_QR" ? "UPI QR" : "Cash"}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={() => setMarkPaid((v) => !v)}
          style={styles.checkRow}
        >
          <View style={[styles.checkbox, markPaid && styles.checkboxOn]}>
            {markPaid ? (
              <Text variant="tiny" color={colors.primaryForeground} weight="700">
                ✓
              </Text>
            ) : null}
          </View>
          <Text variant="small" color={colors.zinc300}>
            Already paid — mark CONFIRMED
          </Text>
        </Pressable>

        {payMode === "UPI_QR" ? (
          <Input
            label="UTR (optional)"
            placeholder="UPI transaction reference"
            value={utr}
            onChangeText={setUtr}
          />
        ) : null}

        {err ? (
          <Text
            variant="small"
            color={colors.destructive}
            style={{ marginTop: spacing["2"] }}
          >
            {err}
          </Text>
        ) : null}
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <View style={styles.totalRow}>
          <Text variant="small" color={colors.zinc400}>
            {lineCount} item{lineCount === 1 ? "" : "s"}
          </Text>
          <Text variant="heading" weight="700" color={colors.emerald400}>
            {rupees(totalPaise)}
          </Text>
        </View>
        <Button
          label="Create sale"
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
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    paddingVertical: spacing["1"],
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.zinc600,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
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
