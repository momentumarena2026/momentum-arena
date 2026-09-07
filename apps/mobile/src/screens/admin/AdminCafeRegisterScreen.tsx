import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useQuery } from "@tanstack/react-query";
import { Camera, Check, X, AlertTriangle, Trash2 } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { colors, radius, spacing } from "../../theme";
import {
  confirmRegister,
  extractRegister,
  fetchRegisterSetup,
  type RegisterRow,
  type RegisterMenuItem,
} from "../../lib/admin-cafe-register";

/**
 * Photograph a page of the cafe register; check what it read; create the
 * orders.
 *
 * This belongs on the phone more than anywhere else: the register is a
 * paper book on the counter and the camera is already in the room. The
 * web version exists for someone at a desk with a scan.
 *
 * The review step is the feature, not an obstacle. Transcription saves
 * the typing; the checking is not optional, because these rows become
 * real orders against real tills and a misread digit is money that will
 * not reconcile.
 */
export function AdminCafeRegisterScreen() {
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [rows, setRows] = useState<RegisterRow[]>([]);
  // Which rows the human changed. Tracked apart from the values because
  // it is a fact about the EDIT — it decides what gets remembered as a
  // deliberate correction rather than a lucky match.
  const [corrected, setCorrected] = useState<Record<number, true>>({});
  const [picking, setPicking] = useState<number | null>(null);

  const setup = useQuery({
    queryKey: ["admin", "cafe-register", "setup"],
    queryFn: fetchRegisterSetup,
    staleTime: 60_000,
  });

  const menu: RegisterMenuItem[] = useMemo(() => setup.data?.menu ?? [], [setup.data]);
  const byId = useMemo(() => new Map(menu.map((m) => [m.id, m])), [menu]);

  const pickPage = useCallback(async () => {
    setError(null);
    setDone(null);
    // Library only, never the camera. The Android build deliberately
    // strips expo-image-picker's CAMERA permission — it cost the Play
    // listing 427 devices — so launchCameraAsync would be denied on
    // exactly the phones the counter staff use. The photo is taken with
    // the normal camera app and chosen here.
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError("Photo access is needed to read a register page.");
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      base64: true,
      // Handwriting survives this comfortably, and the model reads a
      // 1600px page as well as a 4000px one while costing the same.
      quality: 0.85,
    });
    if (picked.canceled || !picked.assets?.[0]?.base64) return;

    setBusy(true);
    try {
      const asset = picked.assets[0];
      const mime = asset.mimeType || "image/jpeg";
      const res = await extractRegister(`data:${mime};base64,${asset.base64}`);
      setUploadId(res.uploadId);
      setRows(res.rows);
      setCorrected({});
      if (res.error) setError(res.error);
      else if (res.rows.length === 0) {
        setError("Nothing readable on that page. Try a straighter, brighter photo.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that page.");
    } finally {
      setBusy(false);
    }
  }, []);

  function patch(i: number, next: Partial<RegisterRow>, isCorrection = false) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...next } : r)));
    if (isCorrection) setCorrected((c) => ({ ...c, [i]: true }));
  }

  const ready = rows.filter((r) => r.cafeItemId && r.payment);
  const blocked = rows.length - ready.length;

  const create = useCallback(async () => {
    setSending(true);
    setError(null);
    try {
      const res = await confirmRegister({
        uploadId,
        rows: rows
          .map((r, i) => ({ r, i }))
          .filter(({ r }) => r.cafeItemId && r.payment)
          .map(({ r, i }) => ({
            rawItem: r.rawItem,
            cafeItemId: r.cafeItemId as string,
            qty: r.qty,
            payment: r.payment as "CASH" | "UPI_QR",
            corrected: !!corrected[i],
          })),
      });
      if (!res.success) {
        setError(res.error ?? "Couldn't create the orders.");
        return;
      }
      setDone(
        `Created ${res.created} order${res.created === 1 ? "" : "s"}` +
          (res.failed ? `, ${res.failed} failed` : "") +
          `. Remembered ${res.learned} shorthand${res.learned === 1 ? "" : "s"}.`,
      );
      setRows([]);
      setUploadId(null);
      void setup.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the orders.");
    } finally {
      setSending(false);
    }
  }, [rows, corrected, uploadId, setup]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text variant="title">Register → Orders</Text>
        <Text variant="small" color={colors.zinc400} style={styles.lede}>
          Photograph a page of the daily register. Every row comes back for you
          to check — nothing is created until you tap the button.
        </Text>

        <Pressable
          onPress={() => void pickPage()}
          disabled={busy}
          style={({ pressed }) => [styles.pick, (pressed || busy) && { opacity: 0.7 }]}
        >
          {busy ? (
            <ActivityIndicator color={colors.emerald400} size="small" />
          ) : (
            <Camera size={17} color={colors.emerald400} />
          )}
          <Text variant="bodyStrong" color={colors.emerald400}>
            {busy ? "Reading the page…" : "Choose a page photo"}
          </Text>
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {done ? <Text style={styles.ok}>{done}</Text> : null}

        {rows.length > 0 ? (
          <>
            <View style={styles.headRow}>
              <Text variant="bodyStrong">
                {rows.length} row{rows.length === 1 ? "" : "s"}
              </Text>
              {blocked > 0 ? (
                <Text variant="tiny" color={colors.yellow400}>
                  {blocked} still need an item or payment
                </Text>
              ) : null}
            </View>

            {rows.map((r, i) => {
              const item = r.cafeItemId ? byId.get(r.cafeItemId) : null;
              const incomplete = !r.cafeItemId || !r.payment;
              return (
                <View
                  key={`${r.rawItem}-${i}`}
                  style={[styles.row, incomplete && styles.rowIncomplete]}
                >
                  <View style={styles.rowTop}>
                    <View style={styles.rowRaw}>
                      {/* As written, kept verbatim — it is what the admin
                          checks the reading against. */}
                      <Text variant="small" weight="700">
                        {r.rawItem}
                      </Text>
                      <Text variant="tiny" color={colors.zinc500}>
                        {r.time ? `${r.time} · ` : ""}
                        {SOURCE_LABEL[r.matchSource]}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                      hitSlop={8}
                    >
                      <Trash2 size={15} color={colors.zinc600} />
                    </Pressable>
                  </View>

                  {/* Item — a tap opens the menu list for this row. */}
                  <Pressable
                    onPress={() => setPicking(picking === i ? null : i)}
                    style={styles.field}
                  >
                    <Text variant="small" color={item ? colors.foreground : colors.yellow400}>
                      {item ? `${item.name} · ${inr(item.price * r.qty)}` : "Pick an item"}
                    </Text>
                  </Pressable>

                  {picking === i ? (
                    <View style={styles.menuList}>
                      {menu.map((m) => (
                        <Pressable
                          key={m.id}
                          onPress={() => {
                            patch(i, { cafeItemId: m.id, itemName: m.name }, true);
                            setPicking(null);
                          }}
                          style={styles.menuItem}
                        >
                          <Text variant="small">{m.name}</Text>
                          <Text variant="tiny" color={colors.zinc500}>
                            {inr(m.price)}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}

                  <View style={styles.rowBottom}>
                    <View style={styles.qtyBox}>
                      <Text variant="tiny" color={colors.zinc500}>
                        Qty
                      </Text>
                      <TextInput
                        value={String(r.qty)}
                        onChangeText={(t) =>
                          patch(i, { qty: Math.max(1, parseInt(t, 10) || 1) })
                        }
                        keyboardType="number-pad"
                        style={styles.qtyInput}
                      />
                    </View>

                    {/* Payment is two buttons, not a default. Which till
                        the money reconciles against is not something to
                        infer from an unclear tick. */}
                    {(["CASH", "UPI_QR"] as const).map((p) => (
                      <Pressable
                        key={p}
                        onPress={() => patch(i, { payment: p })}
                        style={[styles.payBtn, r.payment === p && styles.payBtnOn]}
                      >
                        <Text
                          variant="tiny"
                          weight="700"
                          color={r.payment === p ? "#04140e" : colors.zinc400}
                        >
                          {p === "CASH" ? "Cash" : "Online"}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  {/* Both numbers, never merged: a price change, a staff
                      discount and a misread digit look identical here and
                      need different answers. */}
                  {r.priceWarning ? (
                    <View style={styles.warn}>
                      <AlertTriangle size={11} color={colors.yellow400} />
                      <Text variant="tiny" color={colors.yellow400}>
                        Page says {inr(r.priceWarning.written)}, menu says{" "}
                        {inr(r.priceWarning.expected)}
                      </Text>
                    </View>
                  ) : null}
                </View>
              );
            })}

            <Pressable
              onPress={() => void create()}
              disabled={sending || ready.length === 0}
              style={({ pressed }) => [
                styles.cta,
                (pressed || sending || ready.length === 0) && { opacity: 0.6 },
              ]}
            >
              {sending ? (
                <ActivityIndicator color="#04140e" size="small" />
              ) : (
                <>
                  <Check size={16} color="#04140e" />
                  <Text variant="bodyStrong" color="#04140e">
                    Create {ready.length} order{ready.length === 1 ? "" : "s"}
                  </Text>
                </>
              )}
            </Pressable>
          </>
        ) : null}

        {/* What it has been taught. Not configuration — this is what the
            register has actually been written as. */}
        {setup.data?.aliases.length ? (
          <View style={styles.learned}>
            <Text variant="bodyStrong">
              Shorthand it knows ({setup.data.aliases.length})
            </Text>
            <View style={styles.chips}>
              {setup.data.aliases.slice(0, 30).map((a) => (
                <View key={a.id} style={styles.chip}>
                  <Text variant="tiny" color={colors.zinc300}>
                    {a.term}
                  </Text>
                  <Text variant="tiny" color={colors.zinc600}>
                    →
                  </Text>
                  <Text variant="tiny" color={colors.emerald400}>
                    {a.itemName}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/** Why a row matched. A reviewer scanning twelve rows needs to know
 *  which ones actually deserve a second look. */
const SOURCE_LABEL: Record<RegisterRow["matchSource"], string> = {
  alias: "you taught this",
  exact: "menu name",
  fuzzy: "close spelling — check",
  none: "not recognised",
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const styles = StyleSheet.create({
  scroll: { padding: spacing["4"], gap: 12, paddingBottom: 40 },
  lede: { marginTop: -4 },
  pick: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.emerald400,
    backgroundColor: "rgba(16,185,129,0.08)",
  },
  error: { color: colors.destructive_300, fontSize: 12, lineHeight: 17 },
  ok: { color: colors.emerald400, fontSize: 12, lineHeight: 17 },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 10,
    gap: 8,
    backgroundColor: colors.card,
  },
  rowIncomplete: { borderColor: "rgba(250,204,21,0.45)" },
  rowTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  rowRaw: { flex: 1, gap: 1 },
  field: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  menuList: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    maxHeight: 220,
    overflow: "hidden",
  },
  menuItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowBottom: { flexDirection: "row", alignItems: "center", gap: 8 },
  qtyBox: { flexDirection: "row", alignItems: "center", gap: 6 },
  qtyInput: {
    width: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 8,
    paddingVertical: 6,
    color: colors.foreground,
    fontSize: 13,
  },
  payBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  payBtnOn: { backgroundColor: colors.emerald400, borderColor: colors.emerald400 },
  warn: { flexDirection: "row", alignItems: "center", gap: 5 },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.emerald400,
    paddingVertical: 14,
    borderRadius: radius.lg,
    marginTop: 4,
  },
  learned: { marginTop: 18, gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
});
