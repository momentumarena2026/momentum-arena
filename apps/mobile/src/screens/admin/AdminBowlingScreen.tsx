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
  adminBowlingApi,
  type BowlingDayType,
  type BowlingHalf,
  type BowlingWindow,
} from "../../lib/admin-bowling";
import { AdminApiError } from "../../lib/admin-api";

const DAY_TYPES: BowlingDayType[] = ["WEEKDAY", "WEEKEND"];

function fmt(h: number, m: number) {
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function AdminBowlingScreen() {
  const settings = useQuery({
    queryKey: ["admin", "bowling"],
    queryFn: () => adminBowlingApi.get(),
  });

  const [isActive, setIsActive] = useState(false);
  const [half, setHalf] = useState<BowlingHalf>("LEFT");
  const [windows, setWindows] = useState<BowlingWindow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const s = settings.data?.settings;
    if (s) {
      setIsActive(s.isActive);
      setHalf(s.half);
      setWindows(s.windows);
    }
  }, [settings.data]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await settings.refetch();
    } catch (e) {
      setErr(e instanceof AdminApiError || e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  function patchWindow(idx: number, patch: Partial<BowlingWindow>) {
    setWindows((prev) => prev.map((w, i) => (i === idx ? { ...w, ...patch } : w)));
  }
  function addWindow(dayType: BowlingDayType) {
    setWindows((prev) => [
      ...prev,
      { dayType, startHour: 9, startMinute: 0, endHour: 17, endMinute: 0 },
    ]);
  }
  function removeWindow(idx: number) {
    setWindows((prev) => prev.filter((_, i) => i !== idx));
  }

  if (settings.isLoading) {
    return (
      <Screen>
        <Text variant="small" color={colors.zinc500}>
          Loading…
        </Text>
      </Screen>
    );
  }
  if (!settings.data?.settings) {
    return (
      <Screen>
        <Text variant="small" color={colors.zinc500}>
          Bowling-machine court isn&apos;t configured.
        </Text>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong" color={colors.foreground}>
                Bowling machine
              </Text>
              <Text variant="tiny" color={colors.zinc500}>
                Off hides it from the customer cricket page.
              </Text>
            </View>
            <Switch
              value={isActive}
              disabled={busy}
              onValueChange={(v) => {
                setIsActive(v);
                void run(() => adminBowlingApi.setEnabled(v));
              }}
              trackColor={{ true: colors.emerald500_10, false: colors.zinc700 }}
              thumbColor={isActive ? colors.emerald400 : colors.zinc400}
            />
          </View>
        </Card>

        <Card style={styles.card}>
          <Text variant="small" weight="600" color={colors.foreground}>
            Physical half
          </Text>
          <View style={styles.halfRow}>
            {(["LEFT", "RIGHT"] as BowlingHalf[]).map((h) => (
              <Pressable
                key={h}
                disabled={busy}
                onPress={() => {
                  setHalf(h);
                  void run(() => adminBowlingApi.setHalf(h));
                }}
                style={[styles.halfChip, half === h && styles.halfChipActive]}
              >
                <Text
                  variant="small"
                  weight="600"
                  color={half === h ? colors.emerald400 : colors.zinc400}
                >
                  {h === "LEFT" ? "Left half" : "Right half"}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>

        {DAY_TYPES.map((dt) => {
          const rows = windows
            .map((w, i) => ({ w, i }))
            .filter((x) => x.w.dayType === dt);
          return (
            <Card key={dt} style={styles.card}>
              <View style={styles.rowBetween}>
                <Text variant="small" weight="600" color={colors.foreground}>
                  {dt === "WEEKDAY" ? "Weekday hours" : "Weekend hours"}
                </Text>
                <Pressable onPress={() => addWindow(dt)} hitSlop={8}>
                  <Plus size={18} color={colors.emerald400} />
                </Pressable>
              </View>
              {rows.length === 0 ? (
                <Text variant="tiny" color={colors.zinc500} style={{ marginTop: spacing["2"] }}>
                  No windows — machine closed on {dt.toLowerCase()}s.
                </Text>
              ) : (
                rows.map(({ w, i }) => (
                  <View key={i} style={styles.windowRow}>
                    <TimeField
                      hour={w.startHour}
                      minute={w.startMinute}
                      onHour={(h) => patchWindow(i, { startHour: h })}
                      onMinute={(m) => patchWindow(i, { startMinute: m })}
                    />
                    <Text variant="small" color={colors.zinc500}>
                      →
                    </Text>
                    <TimeField
                      hour={w.endHour}
                      minute={w.endMinute}
                      onHour={(h) => patchWindow(i, { endHour: h })}
                      onMinute={(m) => patchWindow(i, { endMinute: m })}
                    />
                    <Pressable onPress={() => removeWindow(i)} hitSlop={6}>
                      <Trash2 size={15} color={colors.destructive} />
                    </Pressable>
                  </View>
                ))
              )}
            </Card>
          );
        })}

        {err ? (
          <Text variant="small" color={colors.destructive}>
            {err}
          </Text>
        ) : null}

        <Button
          label="Save hours"
          onPress={() =>
            void run(async () => {
              await adminBowlingApi.setWindows(
                windows.map((w) => ({
                  dayType: w.dayType,
                  startHour: w.startHour,
                  startMinute: w.startMinute,
                  endHour: w.endHour,
                  endMinute: w.endMinute,
                })),
              );
              Alert.alert("Saved", "Operating hours updated.");
            })
          }
          loading={busy}
          fullWidth
          size="lg"
        />
      </ScrollView>
    </Screen>
  );
}

function TimeField({
  hour,
  minute,
  onHour,
  onMinute,
}: {
  hour: number;
  minute: number;
  onHour: (h: number) => void;
  onMinute: (m: number) => void;
}) {
  return (
    <View style={styles.timeField}>
      <View style={styles.hourInput}>
        <Input
          keyboardType="number-pad"
          maxLength={2}
          value={String(hour)}
          onChangeText={(t) => {
            const n = Math.max(0, Math.min(24, Number(t.replace(/\D/g, "")) || 0));
            onHour(n);
          }}
        />
      </View>
      <Pressable
        onPress={() => onMinute(minute === 0 ? 30 : 0)}
        style={styles.minuteToggle}
      >
        <Text variant="small" weight="600" color={colors.zinc300}>
          {fmt(0, minute).slice(2)}
        </Text>
      </Pressable>
    </View>
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
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  halfRow: { flexDirection: "row", gap: spacing["2"], marginTop: spacing["1"] },
  halfChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  halfChipActive: { borderColor: colors.emerald400, backgroundColor: colors.emerald500_10 },
  windowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    marginTop: spacing["2"],
  },
  timeField: { flexDirection: "row", alignItems: "center", gap: spacing["1"] },
  hourInput: { width: 56 },
  minuteToggle: {
    paddingHorizontal: spacing["2.5"],
    paddingVertical: spacing["3"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: colors.zinc900,
  },
});
