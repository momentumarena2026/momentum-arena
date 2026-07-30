import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Megaphone } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { colors, radius, spacing } from "../../theme";
import { adminPricingApi } from "../../lib/admin-pricing";
import { AdminApiError } from "../../lib/admin-api";

/**
 * Web & App Config → Information Bar. The announcement strip at the very
 * top of the home page (web + app) — by default the new-user ₹100 offer,
 * editable to whatever the venue wants to announce. Reads/writes through
 * the pricing endpoint like the rain banner beside it.
 */
export function AdminInfoBarScreen() {
  const data = useQuery({
    queryKey: ["admin", "pricing"],
    queryFn: () => adminPricingApi.get(),
  });

  const [enabled, setEnabled] = useState(true);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data.data) return;
    setEnabled(data.data.infoBar?.enabled ?? true);
    setText(data.data.infoBar?.text ?? "");
  }, [data.data]);

  const defaultText = data.data?.infoBar?.defaultText ?? "";
  const shown = text.trim() || defaultText;

  async function save() {
    setBusy(true);
    try {
      await adminPricingApi.saveInfoBar(enabled, text.trim() || null);
      await data.refetch();
      Alert.alert("Saved", "Information bar updated.");
    } catch (e) {
      Alert.alert(
        "Couldn't save",
        e instanceof AdminApiError || e instanceof Error ? e.message : "Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.card}>
          <View style={styles.head}>
            <Megaphone size={16} color={colors.emerald400} />
            <Text variant="bodyStrong" color={colors.foreground}>
              Information Bar
            </Text>
          </View>
          <Text variant="tiny" color={colors.zinc500}>
            The strip at the very top of the home page — web and app. Leave
            the text empty to use the default new-user offer.
          </Text>

          <View style={styles.toggleRow}>
            <Text variant="body" color={colors.foreground}>
              Show the bar
            </Text>
            <Switch
              value={enabled}
              onValueChange={setEnabled}
              trackColor={{ false: colors.zinc700, true: colors.emerald500 }}
              thumbColor="#fff"
            />
          </View>

          <Input
            label="Text (empty = default offer)"
            value={text}
            onChangeText={(v) => setText(v.slice(0, 200))}
            placeholder={defaultText}
            multiline
          />

          <Text variant="tiny" color={colors.zinc500}>
            Preview
          </Text>
          {enabled ? (
            <View style={styles.preview}>
              <Text variant="small" weight="600" style={styles.previewText}>
                {shown}
              </Text>
            </View>
          ) : (
            <View style={styles.previewOff}>
              <Text variant="tiny" color={colors.zinc600}>
                Hidden — the home page shows no bar.
              </Text>
            </View>
          )}

          <Button label="Save" onPress={() => void save()} loading={busy} />
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing["4"], paddingBottom: 40 },
  card: { gap: spacing["3"] },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  preview: {
    backgroundColor: colors.emerald500,
    borderRadius: radius.lg,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  previewText: { color: "#fff", textAlign: "center" },
  previewOff: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.zinc700,
    borderRadius: radius.lg,
    paddingVertical: 10,
    alignItems: "center",
  },
});
