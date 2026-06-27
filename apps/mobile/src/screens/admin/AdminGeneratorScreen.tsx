import { useState } from "react";
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Droplet, Fuel, Gauge, Plus, Timer, X, Zap } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminGeneratorApi,
  type GeneratorDashboard,
  type GeneratorLogType,
  type LogInput,
} from "../../lib/admin-generator";
import { formatRupees } from "../../lib/format";
import { AdminApiError } from "../../lib/admin-api";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Paise → display rupees. Generator money is stored in PAISE. */
function paiseToRupees(paise: number): string {
  return formatRupees(Math.round(paise) / 100);
}

const LOG_TYPES: { id: GeneratorLogType; label: string }[] = [
  { id: "fuel", label: "Fuel" },
  { id: "oil", label: "Oil change" },
  { id: "run", label: "Run hours" },
];

export function AdminGeneratorScreen() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["admin", "generator"],
    queryFn: () => adminGeneratorApi.list(),
  });

  const [formOpen, setFormOpen] = useState(false);
  const [genId, setGenId] = useState<string>("");
  const [genName, setGenName] = useState<string>("");
  const [type, setType] = useState<GeneratorLogType>("fuel");
  const [date, setDate] = useState(isoDate(new Date()));
  const [litres, setLitres] = useState("");
  const [price, setPrice] = useState(""); // rupees per litre (fuel/oil)
  const [hours, setHours] = useState(""); // run duration
  const [isStock, setIsStock] = useState(false);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function openLog(gen: GeneratorDashboard) {
    setGenId(gen.generator.id);
    setGenName(gen.generator.name);
    setType("fuel");
    setDate(isoDate(new Date()));
    setLitres("");
    setPrice("");
    setHours("");
    setIsStock(false);
    setNotes("");
    setErr(null);
    setFormOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      let body: LogInput;
      if (type === "run") {
        const h = Number(hours);
        if (!h || h <= 0) throw new Error("Enter valid running hours");
        body = {
          type: "run",
          generatorId: genId,
          date,
          durationHours: h,
          notes: notes.trim() || undefined,
        };
      } else {
        const l = Number(litres);
        const p = Number(price);
        if (!l || l <= 0) throw new Error("Enter valid litres");
        if (!p || p <= 0) throw new Error("Enter a valid price per litre (₹)");
        if (type === "fuel") {
          body = {
            type: "fuel",
            generatorId: genId,
            date,
            litres: l,
            pricePerLitre: p,
            isStockPurchase: isStock,
            notes: notes.trim() || undefined,
          };
        } else {
          body = {
            type: "oil",
            generatorId: genId,
            date,
            litres: l,
            costPerLitre: p,
            notes: notes.trim() || undefined,
          };
        }
      }
      await adminGeneratorApi.log(body);
    },
    onSuccess: () => {
      setFormOpen(false);
      void qc.invalidateQueries({ queryKey: ["admin", "generator"] });
    },
    onError: (e) =>
      setErr(
        e instanceof AdminApiError || e instanceof Error ? e.message : "Failed",
      ),
  });

  const generators = list.data?.generators ?? [];

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && !list.isLoading}
            onRefresh={() => void list.refetch()}
            tintColor={colors.zinc400}
          />
        }
      >
        {list.isLoading ? (
          <View style={styles.list}>
            {[0, 1].map((i) => (
              <View key={i} style={styles.skeleton}>
                <Skeleton width={140} height={20} />
                <Skeleton width="80%" height={12} />
                <Skeleton width="60%" height={12} />
              </View>
            ))}
          </View>
        ) : generators.length === 0 ? (
          <View style={styles.empty}>
            <Zap size={34} color={colors.zinc600} />
            <Text
              variant="small"
              color={colors.zinc500}
              style={{ marginTop: spacing["2"] }}
            >
              No generators configured.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {generators.map((g) => {
              const oilDue = g.hoursUntilOilChange <= 0;
              return (
                <Card key={g.generator.id} style={styles.genCard}>
                  <View style={styles.genHead}>
                    <View style={styles.genTitle}>
                      <Zap size={16} color={colors.emerald400} />
                      <Text variant="bodyStrong" color={colors.foreground}>
                        {g.generator.name}
                      </Text>
                      {g.activeRunLog ? (
                        <View style={styles.runningPill}>
                          <Text variant="tiny" weight="700" color={colors.emerald400}>
                            RUNNING
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>

                  <View style={styles.statGrid}>
                    <Stat
                      icon={<Gauge size={14} color={colors.zinc400} />}
                      label="Running hrs"
                      value={`${g.totalRunningHours}`}
                    />
                    <Stat
                      icon={<Fuel size={14} color={colors.yellow400} />}
                      label="Fuel filled"
                      value={`${g.totalFuelFilled} L`}
                    />
                    <Stat
                      icon={<Droplet size={14} color={colors.warning} />}
                      label="Oil changes"
                      value={`${g.totalOilChanges}`}
                    />
                    <Stat
                      icon={<Timer size={14} color={colors.zinc400} />}
                      label="Oil due in"
                      value={`${g.hoursUntilOilChange} hr`}
                      valueColor={oilDue ? colors.destructive : undefined}
                    />
                  </View>

                  <View style={styles.costRow}>
                    <Text variant="tiny" color={colors.zinc500}>
                      This month
                    </Text>
                    <Text variant="small" weight="700" color={colors.foreground}>
                      {paiseToRupees(g.monthlyCost)}
                    </Text>
                    <Text variant="tiny" color={colors.zinc600}>
                      (fuel {paiseToRupees(g.monthlyFuelCost)} · oil{" "}
                      {paiseToRupees(g.monthlyOilCost)})
                    </Text>
                  </View>

                  {g.recentFuelLogs.length > 0 || g.recentOilChanges.length > 0 ? (
                    <View style={styles.recent}>
                      {g.recentFuelLogs.slice(0, 2).map((f) => (
                        <Text key={f.id} variant="tiny" color={colors.zinc500}>
                          ⛽ {f.date.slice(0, 10)} · {f.litres} L ·{" "}
                          {paiseToRupees(f.totalCost)}
                          {f.isStockPurchase ? " (stock)" : ""}
                        </Text>
                      ))}
                      {g.recentOilChanges.slice(0, 1).map((o) => (
                        <Text key={o.id} variant="tiny" color={colors.zinc500}>
                          🛢 {o.date.slice(0, 10)} · #{o.sequenceNumber} ·{" "}
                          {paiseToRupees(o.totalCost)}
                        </Text>
                      ))}
                    </View>
                  ) : null}

                  <Button
                    label="Log entry"
                    variant="secondary"
                    onPress={() => openLog(g)}
                    leadingIcon={<Plus size={16} color={colors.foreground} />}
                    fullWidth
                  />
                </Card>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Log modal */}
      <Modal
        visible={formOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setFormOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text variant="title" weight="700">
                Log · {genName}
              </Text>
              <Pressable onPress={() => setFormOpen(false)} hitSlop={8}>
                <X size={22} color={colors.zinc400} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody}>
              <View style={styles.typeRow}>
                {LOG_TYPES.map((t) => (
                  <Pressable
                    key={t.id}
                    onPress={() => setType(t.id)}
                    style={[styles.typeChip, type === t.id && styles.typeChipActive]}
                  >
                    <Text
                      variant="small"
                      weight="600"
                      color={type === t.id ? colors.emerald400 : colors.zinc400}
                    >
                      {t.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Input
                label="Date"
                placeholder="YYYY-MM-DD"
                value={date}
                onChangeText={setDate}
              />

              {type === "run" ? (
                <Input
                  label="Running hours"
                  keyboardType="numeric"
                  placeholder="2.5"
                  value={hours}
                  onChangeText={setHours}
                />
              ) : (
                <>
                  <Input
                    label="Litres"
                    keyboardType="numeric"
                    placeholder={type === "fuel" ? "10" : "1"}
                    value={litres}
                    onChangeText={setLitres}
                  />
                  <Input
                    label={
                      type === "fuel"
                        ? "Price per litre (₹)"
                        : "Oil cost per litre (₹)"
                    }
                    keyboardType="numeric"
                    placeholder={type === "fuel" ? "95" : "295"}
                    value={price}
                    onChangeText={setPrice}
                  />
                  {type === "fuel" ? (
                    <View style={styles.stockRow}>
                      {[
                        { v: false, label: "Filled into generator" },
                        { v: true, label: "Bought into stock" },
                      ].map((opt) => (
                        <Pressable
                          key={String(opt.v)}
                          onPress={() => setIsStock(opt.v)}
                          style={[
                            styles.stockChip,
                            isStock === opt.v && styles.stockChipActive,
                          ]}
                        >
                          <Text
                            variant="tiny"
                            weight="600"
                            color={
                              isStock === opt.v ? colors.emerald400 : colors.zinc400
                            }
                          >
                            {opt.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </>
              )}

              <Input
                label="Note (optional)"
                placeholder="…"
                value={notes}
                onChangeText={setNotes}
              />

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
            <View style={styles.modalFooter}>
              <Button
                label="Save log"
                onPress={() => save.mutate()}
                loading={save.isPending}
                fullWidth
                size="lg"
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function Stat({
  icon,
  label,
  value,
  valueColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.stat}>
      <View style={styles.statLabelRow}>
        {icon}
        <Text variant="tiny" color={colors.zinc500}>
          {label}
        </Text>
      </View>
      <Text variant="bodyStrong" color={valueColor ?? colors.foreground}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["10"],
    gap: spacing["4"],
  },
  list: { gap: spacing["3"] },
  genCard: { padding: spacing["4"], gap: spacing["3"] },
  genHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  genTitle: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  runningPill: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.emerald500_10,
  },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing["3"] },
  stat: {
    flexBasis: "47%",
    flexGrow: 1,
    padding: spacing["3"],
    borderRadius: radius.md,
    backgroundColor: colors.zinc900,
    gap: 4,
  },
  statLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  costRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing["2"],
  },
  recent: { gap: 2 },
  skeleton: {
    padding: spacing["4"],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    gap: spacing["2"],
  },
  empty: { alignItems: "center", paddingVertical: spacing["12"] },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: "90%",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  modalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing["5"],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modalBody: { padding: spacing["5"], gap: spacing["3"] },
  modalFooter: {
    padding: spacing["5"],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  typeRow: { flexDirection: "row", gap: spacing["2"] },
  typeChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  typeChipActive: {
    borderColor: colors.emerald400,
    backgroundColor: colors.emerald500_10,
  },
  stockRow: { flexDirection: "row", gap: spacing["2"] },
  stockChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing["2"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  stockChipActive: {
    borderColor: colors.emerald400,
    backgroundColor: colors.emerald500_10,
  },
});
