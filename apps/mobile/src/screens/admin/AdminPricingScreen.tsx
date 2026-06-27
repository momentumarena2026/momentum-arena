import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { colors, radius, spacing } from "../../theme";
import {
  adminPricingApi,
  type PricingDayType,
  type PricingTimeType,
  type PriceUpdate,
  type TimeBand,
} from "../../lib/admin-pricing";
import { sportLabel } from "../../lib/format";
import { AdminApiError } from "../../lib/admin-api";

const CELLS: { dayType: PricingDayType; timeType: PricingTimeType; label: string }[] = [
  { dayType: "WEEKDAY", timeType: "PEAK", label: "Weekday peak" },
  { dayType: "WEEKDAY", timeType: "OFF_PEAK", label: "Weekday off-peak" },
  { dayType: "WEEKEND", timeType: "PEAK", label: "Weekend peak" },
  { dayType: "WEEKEND", timeType: "OFF_PEAK", label: "Weekend off-peak" },
];

const cellKey = (configId: string, d: PricingDayType, t: PricingTimeType) =>
  `${configId}|${d}|${t}`;

function hourLabel(h: number) {
  const wrapped = h % 24;
  const ampm = wrapped < 12 ? "am" : "pm";
  const h12 = wrapped % 12 === 0 ? 12 : wrapped % 12;
  return `${h12}${ampm}${h >= 24 ? " (+1)" : ""}`;
}

export function AdminPricingScreen() {
  const data = useQuery({
    queryKey: ["admin", "pricing"],
    queryFn: () => adminPricingApi.get(),
  });

  const [prices, setPrices] = useState<Record<string, string>>({});
  const [open, setOpen] = useState("");
  const [close, setClose] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!data.data) return;
    const map: Record<string, string> = {};
    for (const r of data.data.rules) {
      map[cellKey(r.courtConfigId, r.dayType, r.timeType)] = String(r.pricePerSlot);
    }
    setPrices(map);
    setOpen(String(data.data.arena.openHour));
    setClose(String(data.data.arena.closeHour));
  }, [data.data]);

  const bands = useMemo(() => {
    const byDay: Record<PricingDayType, TimeBand[]> = {
      WEEKDAY: [],
      WEEKEND: [],
    };
    for (const b of data.data?.classifications ?? []) byDay[b.dayType].push(b);
    return byDay;
  }, [data.data]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      await data.refetch();
    } catch (e) {
      setErr(e instanceof AdminApiError || e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  function saveCourt(configId: string) {
    const updates: PriceUpdate[] = CELLS.map((c) => ({
      courtConfigId: configId,
      dayType: c.dayType,
      timeType: c.timeType,
      pricePerSlot: Math.max(0, Number(prices[cellKey(configId, c.dayType, c.timeType)]) || 0),
    }));
    void run(`court-${configId}`, async () => {
      await adminPricingApi.savePrices(updates);
      Alert.alert("Saved", "Prices updated.");
    });
  }

  if (data.isLoading) {
    return (
      <Screen>
        <Text variant="small" color={colors.zinc500}>
          Loading…
        </Text>
      </Screen>
    );
  }

  const configs = data.data?.configs ?? [];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Arena hours */}
        <Card style={styles.card}>
          <Text variant="bodyStrong" color={colors.foreground}>
            Arena open hours
          </Text>
          <Text variant="tiny" color={colors.zinc500}>
            24-hour. Close ≥ 24 means after midnight (25 = 1am, 29 = 5am next day).
          </Text>
          <View style={styles.twoCol}>
            <View style={{ flex: 1 }}>
              <Input label="Open" keyboardType="number-pad" value={open} onChangeText={setOpen} />
            </View>
            <View style={{ flex: 1 }}>
              <Input label="Close" keyboardType="number-pad" value={close} onChangeText={setClose} />
            </View>
          </View>
          <Button
            label="Save hours"
            onPress={() =>
              void run("arena", async () => {
                await adminPricingApi.saveArena(Number(open), Number(close));
                Alert.alert("Saved", "Arena hours updated.");
              })
            }
            loading={busy === "arena"}
          />
        </Card>

        {/* Prices per court */}
        <Text variant="tiny" color={colors.zinc500} style={styles.sectionLabel}>
          PRICE PER SLOT (₹)
        </Text>
        {configs.map((cfg) => (
          <Card key={cfg.id} style={styles.card}>
            <Text variant="bodyStrong" color={colors.foreground}>
              {cfg.label}
            </Text>
            <Text variant="tiny" color={colors.zinc500}>
              {sportLabel(cfg.sport)} · {cfg.size}
            </Text>
            <View style={styles.priceGrid}>
              {CELLS.map((c) => {
                const k = cellKey(cfg.id, c.dayType, c.timeType);
                return (
                  <View key={k} style={styles.priceCell}>
                    <Input
                      label={c.label}
                      keyboardType="number-pad"
                      value={prices[k] ?? ""}
                      onChangeText={(t) =>
                        setPrices((p) => ({ ...p, [k]: t.replace(/[^0-9]/g, "") }))
                      }
                    />
                  </View>
                );
              })}
            </View>
            <Button
              label="Save prices"
              variant="secondary"
              onPress={() => saveCourt(cfg.id)}
              loading={busy === `court-${cfg.id}`}
            />
          </Card>
        ))}

        {/* Time bands (read-only) */}
        <Text variant="tiny" color={colors.zinc500} style={styles.sectionLabel}>
          PEAK / OFF-PEAK BANDS
        </Text>
        <Card style={styles.card}>
          {(["WEEKDAY", "WEEKEND"] as PricingDayType[]).map((dt) => (
            <View key={dt} style={{ marginBottom: spacing["2"] }}>
              <Text variant="small" weight="600" color={colors.foreground}>
                {dt === "WEEKDAY" ? "Weekday" : "Weekend"}
              </Text>
              {bands[dt].length === 0 ? (
                <Text variant="tiny" color={colors.zinc500}>
                  No bands — defaults to off-peak.
                </Text>
              ) : (
                bands[dt].map((b) => (
                  <Text key={b.id} variant="tiny" color={colors.zinc400}>
                    {hourLabel(b.startHour)}–{hourLabel(b.endHour)} ·{" "}
                    {b.timeType === "PEAK" ? "Peak" : "Off-peak"}
                  </Text>
                ))
              )}
            </View>
          ))}
          <Text variant="tiny" color={colors.zinc600} style={{ marginTop: spacing["1"] }}>
            Edit peak/off-peak bands from the web admin.
          </Text>
        </Card>

        {err ? (
          <Text variant="small" color={colors.destructive}>
            {err}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["10"],
    gap: spacing["3"],
  },
  card: { padding: spacing["4"], gap: spacing["2"] },
  sectionLabel: {
    letterSpacing: 1.2,
    fontWeight: "700",
    marginTop: spacing["3"],
  },
  twoCol: { flexDirection: "row", gap: spacing["3"], marginTop: spacing["1"] },
  priceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["3"],
    marginTop: spacing["1"],
  },
  priceCell: { flexBasis: "47%", flexGrow: 1 },
});
