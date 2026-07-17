import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { CloudRain } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { colors, radius, spacing } from "../../theme";
import {
  adminPricingApi,
  type RainBannerMode,
} from "../../lib/admin-pricing";
import { AdminApiError } from "../../lib/admin-api";

/**
 * Web & App Config → Rain Banner. Moved out of the Pricing screen so
 * every customer-facing display toggle lives under one More-hub group
 * (mirrors the web sidebar move). Reads/writes through the existing
 * pricing endpoint's rain-banner action.
 */

const RAIN_MODES: { value: RainBannerMode; label: string; hint: string }[] = [
  { value: "AUTO", label: "Auto (weather)", hint: "Shows only when it's raining in Mathura" },
  { value: "ON", label: "Always on", hint: "Force the banner on regardless of weather" },
  { value: "OFF", label: "Off", hint: "Never show the banner" },
];

export function AdminRainBannerScreen() {
  const data = useQuery({
    queryKey: ["admin", "pricing"],
    queryFn: () => adminPricingApi.get(),
  });

  const [mode, setMode] = useState<RainBannerMode>("AUTO");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data.data) return;
    setMode(data.data.rainBanner?.mode ?? "AUTO");
    setText(data.data.rainBanner?.text ?? "");
  }, [data.data]);

  async function save() {
    setBusy(true);
    try {
      await adminPricingApi.saveRainBanner(mode, text.trim() || null);
      await data.refetch();
      Alert.alert("Saved", "Rain banner updated.");
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
            <CloudRain size={16} color="#38bdf8" />
            <Text variant="bodyStrong" color={colors.foreground}>
              &ldquo;Rain doesn&apos;t slow us down&rdquo; banner
            </Text>
          </View>
          <Text variant="tiny" color={colors.zinc500}>
            Weather-aware strip on the homepage + booking page (web and app).
            On Auto it appears only when it&apos;s raining (or rain&apos;s
            forecast) in Mathura.
          </Text>
          <View style={styles.modes}>
            {RAIN_MODES.map((m) => (
              <Pressable
                key={m.value}
                onPress={() => setMode(m.value)}
                style={[styles.modeTile, mode === m.value && styles.modeTileOn]}
              >
                <Text
                  variant="small"
                  weight="600"
                  color={mode === m.value ? "#7dd3fc" : colors.zinc300}
                >
                  {m.label}
                </Text>
                <Text variant="tiny" color={colors.zinc500}>
                  {m.hint}
                </Text>
              </Pressable>
            ))}
          </View>
          <Input
            label="Banner message (optional — blank = default)"
            value={text}
            onChangeText={setText}
            maxLength={200}
            placeholder="Designed for quick drainage and uninterrupted play — book your slot."
          />
          <Button label="Save banner" loading={busy} onPress={() => void save()} />
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing["4"],
    paddingBottom: spacing["8"],
  },
  card: {
    gap: spacing["3"],
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  modes: {
    gap: spacing["2"],
  },
  modeTile: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.background,
    padding: spacing["3"],
    gap: 2,
  },
  modeTileOn: {
    borderColor: "rgba(56,189,248,0.5)",
    backgroundColor: "rgba(56,189,248,0.10)",
  },
});
