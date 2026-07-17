import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { CloudRain, Plus, Trash2, X } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { colors, radius, spacing } from "../../theme";
import {
  adminPricingApi,
  type BandInput,
  type PricingDayType,
  type PricingTimeType,
  type PriceUpdate,
  type RainBannerMode,
  type TimeBand,
} from "../../lib/admin-pricing";
import { sportLabel } from "../../lib/format";
import { AdminApiError } from "../../lib/admin-api";

type BandDraft = {
  // null editingId = creating a new band; otherwise editing that band's row.
  // startHour is the unique-key portion — locked while editing an existing band
  // (delete + re-add to move it), editable when creating.
  editingId: string | null;
  startHour: string;
  endHour: string;
  dayType: PricingDayType;
  timeType: PricingTimeType;
};

const CELLS: { dayType: PricingDayType; timeType: PricingTimeType; label: string }[] = [
  { dayType: "WEEKDAY", timeType: "PEAK", label: "Weekday peak" },
  { dayType: "WEEKDAY", timeType: "OFF_PEAK", label: "Weekday off-peak" },
  { dayType: "WEEKEND", timeType: "PEAK", label: "Weekend peak" },
  { dayType: "WEEKEND", timeType: "OFF_PEAK", label: "Weekend off-peak" },
];

const cellKey = (configId: string, d: PricingDayType, t: PricingTimeType) =>
  `${configId}|${d}|${t}`;

// Mirrors the web RainBannerEditor mode cards (app/(admin)/admin/pricing).
const RAIN_MODES: { value: RainBannerMode; label: string; hint: string }[] = [
  { value: "AUTO", label: "Auto (weather)", hint: "Shows only when it's raining in Mathura" },
  { value: "ON", label: "Always on", hint: "Force the banner on regardless of weather" },
  { value: "OFF", label: "Off", hint: "Never show the banner" },
];

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
  const [bandDraft, setBandDraft] = useState<BandDraft | null>(null);
  const [rainMode, setRainMode] = useState<RainBannerMode>("AUTO");
  const [rainText, setRainText] = useState("");

  useEffect(() => {
    if (!data.data) return;
    const map: Record<string, string> = {};
    for (const r of data.data.rules) {
      map[cellKey(r.courtConfigId, r.dayType, r.timeType)] = String(r.pricePerSlot);
    }
    setPrices(map);
    setOpen(String(data.data.arena.openHour));
    setClose(String(data.data.arena.closeHour));
    setRainMode(data.data.rainBanner?.mode ?? "AUTO");
    setRainText(data.data.rainBanner?.text ?? "");
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

  function startAddBand(dayType: PricingDayType) {
    setErr(null);
    setBandDraft({
      editingId: null,
      startHour: "17",
      endHour: "23",
      dayType,
      timeType: "PEAK",
    });
  }
  function startEditBand(b: TimeBand) {
    setErr(null);
    setBandDraft({
      editingId: b.id,
      startHour: String(b.startHour),
      endHour: String(b.endHour),
      dayType: b.dayType,
      timeType: b.timeType,
    });
  }
  function saveBand() {
    if (!bandDraft) return;
    const startHour = Number(bandDraft.startHour);
    const endHour = Number(bandDraft.endHour);
    if (!Number.isFinite(startHour) || !Number.isFinite(endHour)) {
      setErr("Enter valid hours.");
      return;
    }
    if (endHour <= startHour) {
      setErr("End hour must be after start hour.");
      return;
    }
    const payload: BandInput = {
      startHour,
      endHour,
      dayType: bandDraft.dayType,
      timeType: bandDraft.timeType,
    };
    void run("band-save", async () => {
      await adminPricingApi.saveBand(payload);
      setBandDraft(null);
    });
  }
  function deleteBand(b: TimeBand) {
    Alert.alert(
      "Delete band?",
      `Delete the ${b.dayType === "WEEKDAY" ? "Weekday" : "Weekend"} ${hourLabel(b.startHour)}–${hourLabel(b.endHour)} ${b.timeType === "PEAK" ? "PEAK" : "OFF-PEAK"} band? Hours in this range fall back to off-peak pricing.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            void run(`band-delete-${b.id}`, async () => {
              await adminPricingApi.deleteBand(b.id);
            }),
        },
      ],
    );
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

        {/* "Rain doesn't slow us down" banner — mirror of the web
            RainBannerEditor; lives beside arena hours (both are
            ArenaSettings). */}
        <Card style={styles.card}>
          <View style={styles.rainHead}>
            <CloudRain size={16} color="#38bdf8" />
            <Text variant="bodyStrong" color={colors.foreground}>
              &ldquo;Rain doesn&apos;t slow us down&rdquo; banner
            </Text>
          </View>
          <Text variant="tiny" color={colors.zinc500}>
            Weather-aware strip on the homepage + booking page. On Auto it
            appears only when it&apos;s raining (or rain&apos;s forecast) in
            Mathura.
          </Text>
          <View style={styles.rainModes}>
            {RAIN_MODES.map((m) => (
              <Pressable
                key={m.value}
                onPress={() => setRainMode(m.value)}
                style={[
                  styles.rainModeTile,
                  rainMode === m.value && styles.rainModeTileOn,
                ]}
              >
                <Text
                  variant="small"
                  weight="600"
                  color={rainMode === m.value ? "#7dd3fc" : colors.zinc300}
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
            value={rainText}
            onChangeText={setRainText}
            maxLength={200}
            placeholder="Designed for quick drainage and uninterrupted play — book your slot."
          />
          <Button
            label="Save banner"
            onPress={() =>
              void run("rain", async () => {
                await adminPricingApi.saveRainBanner(
                  rainMode,
                  rainText.trim() || null,
                );
                Alert.alert("Saved", "Rain banner updated.");
              })
            }
            loading={busy === "rain"}
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

        {/* Time bands (editable) */}
        <Text variant="tiny" color={colors.zinc500} style={styles.sectionLabel}>
          PEAK / OFF-PEAK BANDS
        </Text>
        <Text variant="tiny" color={colors.zinc600} style={{ marginTop: -spacing["1"] }}>
          Half-open ranges [start, end). A band of 17–23 covers 5pm through 10:59pm.
        </Text>
        <Card style={styles.card}>
          {(["WEEKDAY", "WEEKEND"] as PricingDayType[]).map((dt) => (
            <View key={dt} style={styles.bandDayBlock}>
              <View style={styles.bandDayHead}>
                <Text variant="small" weight="600" color={colors.foreground}>
                  {dt === "WEEKDAY" ? "Weekday" : "Weekend"}
                </Text>
                <Pressable
                  onPress={() => startAddBand(dt)}
                  hitSlop={8}
                  style={styles.addBandBtn}
                >
                  <Plus size={14} color={colors.emerald400} />
                  <Text variant="tiny" weight="600" color={colors.emerald400}>
                    Add band
                  </Text>
                </Pressable>
              </View>

              {bands[dt].length === 0 && bandDraft?.dayType !== dt ? (
                <Text variant="tiny" color={colors.zinc500}>
                  No bands — defaults to off-peak.
                </Text>
              ) : (
                bands[dt].map((b) =>
                  bandDraft?.editingId === b.id ? (
                    <BandEditor
                      key={b.id}
                      draft={bandDraft}
                      onChange={setBandDraft}
                      onSave={saveBand}
                      onCancel={() => {
                        setBandDraft(null);
                        setErr(null);
                      }}
                      saving={busy === "band-save"}
                      lockStart
                    />
                  ) : (
                    <Pressable
                      key={b.id}
                      onPress={() => startEditBand(b)}
                      style={styles.bandRow}
                    >
                      <View style={styles.bandRowLeft}>
                        <Text variant="small" color={colors.zinc300}>
                          {hourLabel(b.startHour)}–{hourLabel(b.endHour)}
                        </Text>
                        <View
                          style={[
                            styles.bandPill,
                            b.timeType === "PEAK" ? styles.bandPillPeak : styles.bandPillOff,
                          ]}
                        >
                          <Text
                            variant="tiny"
                            weight="600"
                            color={b.timeType === "PEAK" ? colors.destructive_300 : colors.zinc400}
                          >
                            {b.timeType === "PEAK" ? "PEAK" : "OFF PEAK"}
                          </Text>
                        </View>
                      </View>
                      <Pressable hitSlop={8} onPress={() => deleteBand(b)}>
                        <Trash2 size={15} color={colors.destructive} />
                      </Pressable>
                    </Pressable>
                  ),
                )
              )}

              {/* Inline "add" editor for this day */}
              {bandDraft && bandDraft.editingId === null && bandDraft.dayType === dt ? (
                <BandEditor
                  draft={bandDraft}
                  onChange={setBandDraft}
                  onSave={saveBand}
                  onCancel={() => {
                    setBandDraft(null);
                    setErr(null);
                  }}
                  saving={busy === "band-save"}
                  lockStart={false}
                />
              ) : null}
            </View>
          ))}
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

function BandEditor({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
  lockStart,
}: {
  draft: BandDraft;
  onChange: (d: BandDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  lockStart: boolean;
}) {
  return (
    <View style={styles.bandEditor}>
      <View style={styles.bandEditorHead}>
        <Text variant="tiny" weight="700" color={colors.emerald400}>
          {draft.editingId ? "EDIT BAND" : "NEW BAND"}
        </Text>
        <Pressable onPress={onCancel} hitSlop={8}>
          <X size={16} color={colors.zinc400} />
        </Pressable>
      </View>
      <View style={styles.twoCol}>
        <View style={{ flex: 1 }}>
          <Input
            label={lockStart ? "Start (locked)" : "Start hour"}
            keyboardType="number-pad"
            editable={!lockStart}
            value={draft.startHour}
            onChangeText={(t) => onChange({ ...draft, startHour: t.replace(/[^0-9]/g, "") })}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Input
            label="End hour"
            keyboardType="number-pad"
            value={draft.endHour}
            onChangeText={(t) => onChange({ ...draft, endHour: t.replace(/[^0-9]/g, "") })}
          />
        </View>
      </View>
      <Text variant="tiny" color={colors.zinc500} style={styles.fieldLabel}>
        TYPE
      </Text>
      <View style={styles.chipRow}>
        {(["PEAK", "OFF_PEAK"] as PricingTimeType[]).map((t) => (
          <Pressable
            key={t}
            onPress={() => onChange({ ...draft, timeType: t })}
            style={[styles.chip, draft.timeType === t && styles.chipActive]}
          >
            <Text
              variant="small"
              weight="600"
              color={draft.timeType === t ? colors.emerald400 : colors.zinc400}
            >
              {t === "PEAK" ? "Peak" : "Off peak"}
            </Text>
          </Pressable>
        ))}
      </View>
      {lockStart ? (
        <Text variant="tiny" color={colors.zinc600}>
          Start hour is the unique key — delete and re-add to move it.
        </Text>
      ) : null}
      <Button label="Save band" onPress={onSave} loading={saving} size="sm" />
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
  sectionLabel: {
    letterSpacing: 1.2,
    fontWeight: "700",
    marginTop: spacing["3"],
  },
  twoCol: { flexDirection: "row", gap: spacing["3"], marginTop: spacing["1"] },
  rainHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  rainModes: {
    gap: spacing["2"],
    marginVertical: spacing["2"],
  },
  rainModeTile: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.background,
    padding: spacing["3"],
    gap: 2,
  },
  rainModeTileOn: {
    borderColor: "rgba(56,189,248,0.5)",
    backgroundColor: "rgba(56,189,248,0.10)",
  },
  priceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["3"],
    marginTop: spacing["1"],
  },
  priceCell: { flexBasis: "47%", flexGrow: 1 },
  bandDayBlock: { gap: spacing["1.5"], marginBottom: spacing["3"] },
  bandDayHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  addBandBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1"],
    paddingVertical: spacing["1"],
    paddingHorizontal: spacing["2"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_10,
  },
  bandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing["2"],
    paddingHorizontal: spacing["3"],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.card,
  },
  bandRowLeft: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  bandPill: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  bandPillPeak: { borderColor: colors.destructive_30, backgroundColor: colors.destructive_10 },
  bandPillOff: { borderColor: colors.zinc700, backgroundColor: colors.zinc800 },
  bandEditor: {
    gap: spacing["2"],
    padding: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_05,
  },
  bandEditorHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fieldLabel: { letterSpacing: 1.2, fontWeight: "700" },
  chipRow: { flexDirection: "row", gap: spacing["2"] },
  chip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing["2"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  chipActive: { borderColor: colors.emerald400, backgroundColor: colors.emerald500_10 },
});
