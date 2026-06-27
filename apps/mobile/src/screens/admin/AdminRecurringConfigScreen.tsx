import { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { colors, radius, spacing } from "../../theme";
import {
  adminRecurringApi,
  type RecurringConfig,
} from "../../lib/admin-recurring";
import { AdminApiError } from "../../lib/admin-api";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Mirrors web /admin/recurring. Editable recurring-booking config:
 * weekly + daily discount tiers, allowed days, and week/day limits.
 * discountPercent / weeks / days are whole numbers; allowedDays is
 * 0=Sun … 6=Sat. Saving validates server-side via updateRecurringConfig.
 */
export function AdminRecurringConfigScreen() {
  const query = useQuery({
    queryKey: ["admin", "recurring-config"],
    queryFn: () => adminRecurringApi.get(),
  });

  const [cfg, setCfg] = useState<RecurringConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (query.data?.config) setCfg(query.data.config);
  }, [query.data]);

  if (query.isLoading || !cfg) {
    return (
      <Screen>
        <Text variant="small" color={colors.zinc500}>
          Loading…
        </Text>
      </Screen>
    );
  }

  function intInput<K extends "maxWeeks" | "minWeeks" | "maxDays" | "minDays">(
    key: K,
  ) {
    return {
      value: cfg ? String(cfg[key]) : "",
      onChangeText: (t: string) =>
        setCfg((c) =>
          c ? { ...c, [key]: Number(t.replace(/[^0-9]/g, "")) || 0 } : c,
        ),
    };
  }

  function toggleDay(day: number) {
    setCfg((c) => {
      if (!c) return c;
      const has = c.allowedDays.includes(day);
      const allowedDays = has
        ? c.allowedDays.filter((d) => d !== day)
        : [...c.allowedDays, day].sort((a, b) => a - b);
      return { ...c, allowedDays };
    });
  }

  function updateTier(i: number, patch: Partial<RecurringConfig["tiers"][0]>) {
    setCfg((c) =>
      c
        ? {
            ...c,
            tiers: c.tiers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)),
          }
        : c,
    );
  }
  function addTier() {
    setCfg((c) =>
      c ? { ...c, tiers: [...c.tiers, { weeks: 4, discountPercent: 5 }] } : c,
    );
  }
  function removeTier(i: number) {
    setCfg((c) =>
      c ? { ...c, tiers: c.tiers.filter((_, idx) => idx !== i) } : c,
    );
  }

  function updateDaily(i: number, patch: Partial<RecurringConfig["dailyTiers"][0]>) {
    setCfg((c) =>
      c
        ? {
            ...c,
            dailyTiers: c.dailyTiers.map((t, idx) =>
              idx === i ? { ...t, ...patch } : t,
            ),
          }
        : c,
    );
  }
  function addDaily() {
    setCfg((c) =>
      c
        ? { ...c, dailyTiers: [...c.dailyTiers, { days: 5, discountPercent: 3 }] }
        : c,
    );
  }
  function removeDaily(i: number) {
    setCfg((c) =>
      c ? { ...c, dailyTiers: c.dailyTiers.filter((_, idx) => idx !== i) } : c,
    );
  }

  async function save() {
    if (!cfg) return;
    setBusy(true);
    setErr(null);
    try {
      const { id: _id, ...input } = cfg;
      await adminRecurringApi.save(input);
      Alert.alert("Saved", "Recurring config updated.");
      void query.refetch();
    } catch (e) {
      setErr(
        e instanceof AdminApiError || e instanceof Error ? e.message : "Failed",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text variant="small" weight="500" color={colors.foreground}>
                Recurring enabled
              </Text>
              <Text variant="tiny" color={colors.zinc500}>
                Master switch for recurring bookings
              </Text>
            </View>
            <Switch
              value={cfg.enabled}
              onValueChange={(v) => setCfg({ ...cfg, enabled: v })}
              trackColor={{ true: colors.emerald500_10, false: colors.zinc700 }}
              thumbColor={cfg.enabled ? colors.emerald400 : colors.zinc400}
            />
          </View>
        </Card>

        {/* Allowed days */}
        <Text variant="tiny" color={colors.zinc500} style={styles.section}>
          ALLOWED DAYS
        </Text>
        <View style={styles.dayRow}>
          {DAY_LABELS.map((label, day) => {
            const on = cfg.allowedDays.includes(day);
            return (
              <Pressable
                key={day}
                onPress={() => toggleDay(day)}
                style={[styles.dayChip, on && styles.dayChipActive]}
              >
                <Text
                  variant="tiny"
                  weight="600"
                  color={on ? colors.emerald400 : colors.zinc400}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Weekly tiers */}
        <View style={styles.sectionRow}>
          <Text variant="tiny" color={colors.zinc500} style={styles.section}>
            WEEKLY DISCOUNT TIERS
          </Text>
          <Pressable onPress={addTier} hitSlop={8} style={styles.addBtn}>
            <Plus size={14} color={colors.emerald400} />
            <Text variant="tiny" weight="600" color={colors.emerald400}>
              Add
            </Text>
          </Pressable>
        </View>
        <Card style={styles.card}>
          {cfg.tiers.length === 0 ? (
            <Text variant="tiny" color={colors.zinc600}>
              No weekly tiers.
            </Text>
          ) : (
            cfg.tiers.map((t, i) => (
              <View key={i} style={styles.tierRow}>
                <View style={{ flex: 1 }}>
                  <Input
                    label="Weeks"
                    keyboardType="numeric"
                    value={String(t.weeks)}
                    onChangeText={(v) =>
                      updateTier(i, { weeks: Number(v.replace(/[^0-9]/g, "")) || 0 })
                    }
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Input
                    label="Discount %"
                    keyboardType="numeric"
                    value={String(t.discountPercent)}
                    onChangeText={(v) =>
                      updateTier(i, {
                        discountPercent: Number(v.replace(/[^0-9.]/g, "")) || 0,
                      })
                    }
                  />
                </View>
                <Pressable
                  onPress={() => removeTier(i)}
                  hitSlop={8}
                  style={styles.tierDel}
                >
                  <Trash2 size={16} color={colors.destructive} />
                </Pressable>
              </View>
            ))
          )}
          <View style={styles.twoCol}>
            <View style={{ flex: 1 }}>
              <Input label="Min weeks" keyboardType="numeric" {...intInput("minWeeks")} />
            </View>
            <View style={{ flex: 1 }}>
              <Input label="Max weeks" keyboardType="numeric" {...intInput("maxWeeks")} />
            </View>
          </View>
        </Card>

        {/* Daily tiers */}
        <View style={styles.sectionRow}>
          <Text variant="tiny" color={colors.zinc500} style={styles.section}>
            DAILY DISCOUNT TIERS
          </Text>
          <Pressable onPress={addDaily} hitSlop={8} style={styles.addBtn}>
            <Plus size={14} color={colors.emerald400} />
            <Text variant="tiny" weight="600" color={colors.emerald400}>
              Add
            </Text>
          </Pressable>
        </View>
        <Card style={styles.card}>
          {cfg.dailyTiers.length === 0 ? (
            <Text variant="tiny" color={colors.zinc600}>
              No daily tiers.
            </Text>
          ) : (
            cfg.dailyTiers.map((t, i) => (
              <View key={i} style={styles.tierRow}>
                <View style={{ flex: 1 }}>
                  <Input
                    label="Days"
                    keyboardType="numeric"
                    value={String(t.days)}
                    onChangeText={(v) =>
                      updateDaily(i, { days: Number(v.replace(/[^0-9]/g, "")) || 0 })
                    }
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Input
                    label="Discount %"
                    keyboardType="numeric"
                    value={String(t.discountPercent)}
                    onChangeText={(v) =>
                      updateDaily(i, {
                        discountPercent: Number(v.replace(/[^0-9.]/g, "")) || 0,
                      })
                    }
                  />
                </View>
                <Pressable
                  onPress={() => removeDaily(i)}
                  hitSlop={8}
                  style={styles.tierDel}
                >
                  <Trash2 size={16} color={colors.destructive} />
                </Pressable>
              </View>
            ))
          )}
          <View style={styles.twoCol}>
            <View style={{ flex: 1 }}>
              <Input label="Min days" keyboardType="numeric" {...intInput("minDays")} />
            </View>
            <View style={{ flex: 1 }}>
              <Input label="Max days" keyboardType="numeric" {...intInput("maxDays")} />
            </View>
          </View>
        </Card>

        {err ? (
          <Text variant="small" color={colors.destructive}>
            {err}
          </Text>
        ) : null}

        <Button
          label="Save config"
          onPress={save}
          loading={busy}
          fullWidth
          size="lg"
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["10"],
    gap: spacing["2"],
  },
  card: { padding: spacing["4"], gap: spacing["3"] },
  section: { letterSpacing: 1.2, fontWeight: "700", marginTop: spacing["3"] },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1"],
    marginTop: spacing["3"],
  },
  dayRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing["2"] },
  dayChip: {
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  dayChipActive: {
    borderColor: colors.emerald400,
    backgroundColor: colors.emerald500_10,
  },
  tierRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing["2"],
  },
  tierDel: { paddingBottom: spacing["3"] },
  twoCol: { flexDirection: "row", gap: spacing["3"] },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: spacing["3"] },
});
