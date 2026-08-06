import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { Text } from "../../components/ui/Text";
import { colors, radius, spacing } from "../../theme";
import { formatRupees } from "../../lib/format";
import {
  adminCafeApi,
  getCafeOrderDue,
  settleCafeOrderDue,
  addOrderItems,
  cancelOrderItems,
  getOrderHistory,
  type CafeOrderEdit,
  type CafeDue,
  type CafeOrderHistoryRow,
} from "../../lib/admin-cafe";
import type { AdminCafeStackParamList } from "../../navigation/types";

/**
 * One cafe order, in full.
 *
 * The list previously went nowhere on tap — a dead end for anything the
 * row could not fit: the item breakdown, the payment split, the
 * outstanding balance, and the status actions.
 *
 * The order arrives as a route param rather than being refetched: the list
 * already holds every field this screen shows, so a detail endpoint would
 * be a second source of the same truth. The one thing it does fetch is the
 * balance, because that changes as instalments are recorded here.
 */

const STATUS_FLOW: Record<string, string | null> = {
  PENDING: "PREPARING",
  PREPARING: "READY",
  READY: "COMPLETED",
  COMPLETED: null,
  CANCELLED: null,
};

const STATUS_TONE: Record<string, string> = {
  PENDING: colors.yellow400,
  PREPARING: "#7dd3fc",
  READY: colors.emerald400,
  COMPLETED: colors.emerald400,
  CANCELLED: "#f87171",
};

export function AdminCafeOrderDetailScreen() {
  const route = useRoute<RouteProp<AdminCafeStackParamList, "AdminCafeOrderDetail">>();
  const navigation = useNavigation();
  const [order, setOrder] = useState<CafeOrderHistoryRow>(route.params.order);
  const [due, setDue] = useState<CafeDue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<CafeOrderEdit[]>([]);
  const [menu, setMenu] = useState<{ id: string; name: string; price: number }[]>([]);
  const [editing, setEditing] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [cash, setCash] = useState("");
  const [upi, setUpi] = useState("");

  async function loadDue() {
    try {
      setDue(await getCafeOrderDue(order.id));
    } catch {
      // No balance info just hides that card; it must not blank the screen.
      setDue(null);
    }
  }

  async function loadHistory() {
    try {
      setHistory((await getOrderHistory(order.id)).history);
    } catch {
      setHistory([]);
    }
  }

  async function loadMenu() {
    try {
      const res = await adminCafeApi.items();
      setMenu(res.items.map((i) => ({ id: i.id, name: i.name, price: i.price })));
    } catch {
      setMenu([]);
    }
  }

  /** Items and totals are recomputed server-side, so after any edit the
   *  screen refetches rather than patching its local copy — guessing the
   *  new total here is how the app and the till start disagreeing. */
  async function afterItemEdit() {
    await Promise.all([loadDue(), loadHistory()]);
    Alert.alert("Order updated", "Reopen the order to see the new totals.");
  }

  useEffect(() => {
    void loadHistory();
    void loadMenu();
    void loadDue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  const next = STATUS_FLOW[order.status] ?? null;

  async function advance() {
    if (!next) return;
    setBusy(true);
    setError(null);
    try {
      await adminCafeApi.setOrderStatus(order.id, next as never);
      setOrder((o) => ({ ...o, status: next as never }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update status");
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    Alert.alert("Cancel this order?", "This cannot be undone.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Cancel order",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await adminCafeApi.cancelOrder(order.id, "Cancelled by admin");
            setOrder((o) => ({ ...o, status: "CANCELLED" as never }));
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not cancel");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  async function settle() {
    setBusy(true);
    setError(null);
    try {
      const res = await settleCafeOrderDue({
        orderId: order.id,
        cashAmount: Number(cash) || 0,
        upiAmount: Number(upi) || 0,
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setCash("");
      setUpi("");
      setCollecting(false);
      await loadDue();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the payment");
    } finally {
      setBusy(false);
    }
  }

  const customer = order.user?.name || order.guestName || "Walk-in";
  const phone = order.user?.phone || order.guestPhone;

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text variant="bodyStrong" color={colors.foreground}>
            {order.orderNumber}
          </Text>
          <Text weight="700" color={STATUS_TONE[order.status] ?? colors.zinc400}>
            {order.status}
          </Text>
        </View>
        <Text variant="small" color={colors.zinc500}>
          {new Date(order.createdAt).toLocaleString("en-IN", {
            day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
            timeZone: "Asia/Kolkata",
          })}
        </Text>
        {order.note ? (
          <Text variant="small" color={colors.yellow400} style={{ marginTop: 6 }}>
            📝 {order.note}
          </Text>
        ) : null}
      </View>

      {/* CUSTOMER — its own section on web, so its own card here. */}
      <View style={styles.card}>
        <Text variant="small" color={colors.zinc500}>CUSTOMER</Text>
        <Text color={colors.foreground}>{customer}</Text>
        {phone ? (
          <Text variant="small" color={colors.zinc400}>{phone}</Text>
        ) : null}
      </View>

      {/* PAYMENT */}
      <View style={styles.card}>
        <Text variant="small" color={colors.zinc500}>PAYMENT</Text>
        {order.paymentMethod || order.paymentStatus ? (
          <View style={styles.rowBetween}>
            <Text variant="small" color={colors.zinc300}>
              {order.paymentMethod ?? "—"}
            </Text>
            <Text variant="small" color={colors.zinc300}>
              {order.paymentStatus ?? "—"}
            </Text>
          </View>
        ) : (
          <Text variant="small" color={colors.zinc500}>No payment info</Text>
        )}
      </View>

      {/* ORDER ITEMS */}
      <View style={styles.card}>
        <Text variant="small" color={colors.zinc500}>ORDER ITEMS</Text>
        {order.items.map((i) => (
          <View key={i.id} style={styles.rowBetween}>
            <Text variant="small" color={colors.zinc300}>
              {i.quantity}× {i.itemName}
            </Text>
            <Text variant="small" color={colors.zinc300}>
              {formatRupees(i.unitPrice * i.quantity)}
            </Text>
          </View>
        ))}
        <View style={[styles.rowBetween, styles.totalRow]}>
          <Text weight="700" color={colors.foreground}>Total</Text>
          <Text weight="700" color={colors.foreground}>
            {formatRupees(order.totalAmount)}
          </Text>
        </View>
      </View>

      {/* Outstanding balance — only when there is one. */}
      {due && due.dueAmount > 0 && (
        <View style={[styles.card, styles.dueCard]}>
          <View style={styles.rowBetween}>
            <Text weight="700" color={colors.foreground}>Pending</Text>
            <Text weight="700" color={colors.yellow400}>
              {formatRupees(due.dueAmount)}
            </Text>
          </View>
          <Text variant="small" color={colors.zinc400}>
            {formatRupees(due.collectedAtCounter)} at the counter
            {due.collectedLater > 0 ? ` · ${formatRupees(due.collectedLater)} later` : ""}
          </Text>
          {collecting ? (
            <>
              <View style={styles.row}>
                <TextInput style={styles.input} placeholder="Cash ₹" keyboardType="numeric" placeholderTextColor={colors.zinc600} value={cash} onChangeText={setCash} />
                <TextInput style={styles.input} placeholder="UPI ₹" keyboardType="numeric" placeholderTextColor={colors.zinc600} value={upi} onChangeText={setUpi} />
              </View>
              <View style={styles.row}>
                <Pressable disabled={busy} onPress={settle} style={styles.btn}>
                  <Text variant="small" color={colors.emerald400}>Record payment</Text>
                </Pressable>
                <Pressable onPress={() => setCollecting(false)} style={styles.btn}>
                  <Text variant="small" color={colors.zinc400}>Cancel</Text>
                </Pressable>
                <Pressable onPress={() => { setCash(String(due.dueAmount)); setUpi(""); }} style={styles.btn}>
                  <Text variant="small" color={colors.zinc500}>Full in cash</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <Pressable onPress={() => setCollecting(true)} style={[styles.btn, { marginTop: 8 }]}>
              <Text variant="small" color={colors.yellow400}>
                Collect {formatRupees(due.dueAmount)}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {error ? (
        <Text variant="small" color="#f87171">{error}</Text>
      ) : null}

      {/* EDIT ORDER ITEMS */}
      <View style={styles.card}>
        <Text variant="small" color={colors.zinc500}>EDIT ORDER ITEMS</Text>
        {editing ? (
          <>
            <Text variant="small" color={colors.zinc400}>
              Tap an item to add one to this order.
            </Text>
            <View style={styles.row}>
              {menu.map((mi) => (
                <Pressable
                  key={mi.id}
                  disabled={busy}
                  onPress={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await addOrderItems(order.id, [{ cafeItemId: mi.id, quantity: 1 }]);
                      await afterItemEdit();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Could not add the item");
                    } finally {
                      setBusy(false);
                    }
                  }}
                  style={styles.btn}
                >
                  <Text variant="small" color={colors.zinc300}>
                    + {mi.name}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text variant="small" color={colors.zinc400} style={{ marginTop: 8 }}>
              Remove a line:
            </Text>
            <View style={styles.row}>
              {order.items.map((i) => (
                <Pressable
                  key={i.id}
                  disabled={busy}
                  onPress={() => {
                    Alert.alert("Remove this line?", `${i.quantity}× ${i.itemName}`, [
                      { text: "Keep", style: "cancel" },
                      {
                        text: "Remove",
                        style: "destructive",
                        onPress: async () => {
                          setBusy(true);
                          try {
                            await cancelOrderItems(order.id, [i.id]);
                            await afterItemEdit();
                          } catch (e) {
                            setError(e instanceof Error ? e.message : "Could not remove");
                          } finally {
                            setBusy(false);
                          }
                        },
                      },
                    ]);
                  }}
                  style={styles.btn}
                >
                  <Text variant="small" color="#f87171">
                    − {i.quantity}× {i.itemName}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={() => setEditing(false)} style={[styles.btn, { marginTop: 8 }]}>
              <Text variant="small" color={colors.zinc400}>Done</Text>
            </Pressable>
          </>
        ) : (
          <Pressable onPress={() => setEditing(true)} style={styles.btn}>
            <Text variant="small" color="#7dd3fc">Edit items</Text>
          </Pressable>
        )}
      </View>

      {/* HISTORY */}
      <View style={styles.card}>
        <Text variant="small" color={colors.zinc500}>HISTORY</Text>
        {history.length === 0 ? (
          <Text variant="small" color={colors.zinc500}>No history yet</Text>
        ) : (
          history.map((h) => (
            <View key={h.id} style={{ marginTop: 6 }}>
              <Text variant="small" color={colors.zinc300}>
                {h.editType.replace(/_/g, " ").toLowerCase()}
                {h.previousAmount != null && h.newAmount != null
                  ? ` · ${formatRupees(h.previousAmount)} → ${formatRupees(h.newAmount)}`
                  : ""}
              </Text>
              <Text variant="small" color={colors.zinc500}>
                {h.adminUsername} ·{" "}
                {new Date(h.createdAt).toLocaleString("en-IN", {
                  day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
                  timeZone: "Asia/Kolkata",
                })}
                {h.note ? ` · ${h.note}` : ""}
              </Text>
            </View>
          ))
        )}
      </View>

      {/* ACTIONS */}
      <View style={styles.card}>
        <Text variant="small" color={colors.zinc500}>ACTIONS</Text>
        <View style={styles.row}>
        {next && (
          <Pressable disabled={busy} onPress={advance} style={styles.btn}>
            <Text variant="small" color={colors.emerald400}>Mark {next}</Text>
          </Pressable>
        )}
        {order.status !== "CANCELLED" && order.status !== "COMPLETED" && (
          <Pressable disabled={busy} onPress={cancel} style={styles.btn}>
            <Text variant="small" color="#f87171">Cancel order</Text>
          </Pressable>
        )}
          <Pressable onPress={() => navigation.goBack()} style={styles.btn}>
            <Text variant="small" color={colors.zinc400}>Back</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing["5"], gap: 12, paddingBottom: 40 },
  card: {
    gap: 6,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 14,
  },
  dueCard: { borderColor: "rgba(251,191,36,0.4)" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  totalRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, marginTop: 4 },
  input: {
    flex: 1,
    minWidth: 100,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.inputBackground,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.foreground,
  },
  btn: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
