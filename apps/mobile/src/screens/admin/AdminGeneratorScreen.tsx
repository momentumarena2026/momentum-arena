import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Droplet,
  Fuel,
  Gauge,
  Play,
  Plus,
  Settings,
  Square,
  Timer,
  Trash2,
  X,
  Zap,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminGeneratorApi,
  type GeneratorAnalytics,
  type GeneratorConfig,
  type GeneratorDashboard,
  type GeneratorLogType,
  type LogInput,
} from "../../lib/admin-generator";
import { formatRupees } from "../../lib/format";
import { AdminApiError } from "../../lib/admin-api";

// ─── helpers ───────────────────────────────────────────────────
function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function isoMonth(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
/** Paise → display rupees. Generator money is stored in PAISE. */
function paiseToRupees(paise: number): string {
  return formatRupees(Math.round(paise) / 100);
}
function errMsg(e: unknown): string {
  return e instanceof AdminApiError || e instanceof Error ? e.message : "Failed";
}

type Tab = "dashboard" | "fuel" | "oil" | "run" | "config" | "analytics";
const TABS: { key: Tab; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "fuel", label: "Fuel" },
  { key: "oil", label: "Oil" },
  { key: "run", label: "Run log" },
  { key: "config", label: "Config" },
  { key: "analytics", label: "Analytics" },
];

const LOG_TYPES: { id: GeneratorLogType; label: string }[] = [
  { id: "fuel", label: "Fuel" },
  { id: "oil", label: "Oil change" },
  { id: "run", label: "Run hours" },
];

// ════════════════════════════════════════════════════════════════
//  Main screen
// ════════════════════════════════════════════════════════════════
export function AdminGeneratorScreen() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["admin", "generator"],
    queryFn: () => adminGeneratorApi.list(),
  });

  const generators = useMemo(() => list.data?.generators ?? [], [list.data]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [tab, setTab] = useState<Tab>("dashboard");

  // keep a valid selection as the list loads / changes
  useEffect(() => {
    if (generators.length === 0) {
      if (selectedId) setSelectedId("");
      return;
    }
    if (!generators.some((g) => g.generator.id === selectedId)) {
      setSelectedId(generators[0].generator.id);
    }
  }, [generators, selectedId]);

  const selected = generators.find((g) => g.generator.id === selectedId) ?? null;

  // create / delete
  const [createOpen, setCreateOpen] = useState(false);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [createErr, setCreateErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const id = newId.trim();
      const name = newName.trim();
      if (id.length < 2) throw new Error("Generator ID must be at least 2 characters");
      if (!/^[a-zA-Z0-9_-]+$/.test(id))
        throw new Error("ID: letters, numbers, hyphens, underscores only");
      if (!name) throw new Error("Enter a display name");
      await adminGeneratorApi.create(id, name);
      return id;
    },
    onSuccess: (id) => {
      setCreateOpen(false);
      setNewId("");
      setNewName("");
      setSelectedId(id);
      void qc.invalidateQueries({ queryKey: ["admin", "generator"] });
    },
    onError: (e) => setCreateErr(errMsg(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminGeneratorApi.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "generator"] }),
    onError: (e) => Alert.alert("Could not delete", errMsg(e)),
  });

  function confirmDelete() {
    if (!selected) return;
    Alert.alert(
      "Delete generator?",
      `"${selected.generator.name}" will be hidden from the list. Its logs are kept.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => remove.mutate(selected.generator.id),
        },
      ],
    );
  }

  function openCreate() {
    setNewId("");
    setNewName("");
    setCreateErr(null);
    setCreateOpen(true);
  }

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
        {/* generator selector + add */}
        <View style={styles.topRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.genChips}
          >
            {generators.map((g) => {
              const active = g.generator.id === selectedId;
              return (
                <Pressable
                  key={g.generator.id}
                  onPress={() => setSelectedId(g.generator.id)}
                  style={[styles.genChip, active && styles.genChipActive]}
                >
                  <Zap
                    size={13}
                    color={active ? colors.emerald400 : colors.zinc500}
                  />
                  <Text
                    variant="small"
                    weight="600"
                    color={active ? colors.emerald400 : colors.zinc400}
                  >
                    {g.generator.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable onPress={openCreate} style={styles.addBtn} hitSlop={6}>
            <Plus size={18} color={colors.primaryForeground} />
          </Pressable>
        </View>

        {list.isLoading ? (
          <View style={styles.list}>
            {[0, 1].map((i) => (
              <Skeleton key={i} width="100%" height={120} />
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
              No generators yet.
            </Text>
            <Button
              label="Add generator"
              variant="secondary"
              onPress={openCreate}
              leadingIcon={<Plus size={16} color={colors.foreground} />}
              style={{ marginTop: spacing["3"] }}
            />
          </View>
        ) : selected ? (
          <>
            {/* tab bar */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tabBar}
            >
              {TABS.map((t) => (
                <Pressable
                  key={t.key}
                  onPress={() => setTab(t.key)}
                  style={[styles.tab, tab === t.key && styles.tabActive]}
                >
                  <Text
                    variant="small"
                    weight="600"
                    color={tab === t.key ? colors.foreground : colors.zinc400}
                  >
                    {t.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {tab === "dashboard" && (
              <DashboardTab gen={selected} onDelete={confirmDelete} />
            )}
            {tab === "fuel" && <FuelTab gen={selected} />}
            {tab === "oil" && <OilTab gen={selected} />}
            {tab === "run" && <RunLogTab gen={selected} />}
            {tab === "config" && <ConfigTab generators={generators} />}
            {tab === "analytics" && <AnalyticsTab gen={selected} />}
          </>
        ) : null}
      </ScrollView>

      {/* create generator modal */}
      <Modal
        visible={createOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setCreateOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text variant="title" weight="700">
                Add generator
              </Text>
              <Pressable onPress={() => setCreateOpen(false)} hitSlop={8}>
                <X size={22} color={colors.zinc400} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody}>
              <Input
                label="Generator ID"
                placeholder="xgen_2026"
                autoCapitalize="none"
                autoCorrect={false}
                value={newId}
                onChangeText={setNewId}
              />
              <Input
                label="Display name"
                placeholder="Generator 1"
                value={newName}
                onChangeText={setNewName}
              />
              {createErr ? (
                <Text variant="small" color={colors.destructive}>
                  {createErr}
                </Text>
              ) : null}
            </ScrollView>
            <View style={styles.modalFooter}>
              <Button
                label="Create generator"
                onPress={() => create.mutate()}
                loading={create.isPending}
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

// ════════════════════════════════════════════════════════════════
//  Dashboard tab
// ════════════════════════════════════════════════════════════════
function DashboardTab({
  gen,
  onDelete,
}: {
  gen: GeneratorDashboard;
  onDelete: () => void;
}) {
  const oilUrgent = gen.hoursUntilOilChange <= 10;
  const oilWarning = gen.hoursUntilOilChange <= 20;
  const progress =
    gen.nextOilChangeAt > 0
      ? Math.min(100, (gen.totalRunningHours / gen.nextOilChangeAt) * 100)
      : 0;
  const barColor = oilUrgent
    ? colors.destructive
    : oilWarning
      ? colors.warning
      : colors.emerald500;

  return (
    <View style={{ gap: spacing["4"] }}>
      <View style={styles.statGrid}>
        <Stat
          icon={<Gauge size={14} color={colors.emerald400} />}
          label="Running hrs"
          value={`${gen.totalRunningHours}`}
        />
        <Stat
          icon={<Fuel size={14} color={colors.yellow400} />}
          label="Fuel filled"
          value={`${gen.totalFuelFilled} L`}
        />
        <Stat
          icon={<Droplet size={14} color={oilUrgent ? colors.destructive : colors.warning} />}
          label="Oil due in"
          value={`${gen.hoursUntilOilChange} hr`}
          valueColor={oilUrgent ? colors.destructive : oilWarning ? colors.warning : undefined}
          sub={`at ${gen.nextOilChangeAt} hr`}
        />
        <Stat
          icon={<BarChart3 size={14} color={colors.yellow400} />}
          label="Monthly cost"
          value={paiseToRupees(gen.monthlyCost)}
          sub={`fuel ${paiseToRupees(gen.monthlyFuelCost)} · oil ${paiseToRupees(gen.monthlyOilCost)}`}
        />
      </View>

      {/* oil change progress */}
      <Card style={{ padding: spacing["4"], gap: spacing["2"] }}>
        <View style={styles.rowBetween}>
          <Text variant="small" weight="600" color={colors.zinc300}>
            Oil change #{gen.totalOilChanges + 1}
          </Text>
          <Text variant="tiny" color={colors.zinc500}>
            {gen.totalRunningHours} / {gen.nextOilChangeAt} hr
          </Text>
        </View>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${progress}%`, backgroundColor: barColor },
            ]}
          />
        </View>
      </Card>

      {/* recent fuel */}
      <Card style={{ padding: spacing["4"], gap: spacing["2"] }}>
        <Text variant="bodyStrong" color={colors.foreground}>
          Recent fuel logs
        </Text>
        {gen.recentFuelLogs.length === 0 ? (
          <Text variant="small" color={colors.zinc500}>
            No fuel logs yet
          </Text>
        ) : (
          gen.recentFuelLogs.slice(0, 5).map((f) => (
            <View key={f.id} style={styles.rowBetween}>
              <Text variant="small" color={colors.zinc400}>
                {f.date.slice(0, 10)} · {f.litres} L
              </Text>
              <Text variant="small" color={colors.zinc300}>
                {paiseToRupees(f.totalCost)}
              </Text>
            </View>
          ))
        )}
      </Card>

      {/* recent oil */}
      <Card style={{ padding: spacing["4"], gap: spacing["2"] }}>
        <Text variant="bodyStrong" color={colors.foreground}>
          Recent oil changes
        </Text>
        {gen.recentOilChanges.length === 0 ? (
          <Text variant="small" color={colors.zinc500}>
            No oil changes logged
          </Text>
        ) : (
          gen.recentOilChanges.slice(0, 5).map((o) => (
            <View key={o.id} style={styles.rowBetween}>
              <Text variant="small" color={colors.zinc400}>
                #{o.sequenceNumber} · {o.date.slice(0, 10)} · {o.runningHoursAtChange} hr
              </Text>
              <Text variant="small" color={colors.zinc300}>
                {paiseToRupees(o.totalCost)}
              </Text>
            </View>
          ))
        )}
      </Card>

      <Button
        label="Delete generator"
        variant="destructive"
        onPress={onDelete}
        leadingIcon={<Trash2 size={16} color={colors.destructive_300} />}
        fullWidth
      />
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
//  Fuel tab — log form + month-filtered history
// ════════════════════════════════════════════════════════════════
function FuelTab({ gen }: { gen: GeneratorDashboard }) {
  const qc = useQueryClient();
  const generatorId = gen.generator.id;
  const [month, setMonth] = useState(isoMonth(new Date()));

  const history = useQuery({
    queryKey: ["admin", "generator", "fuel", generatorId, month],
    queryFn: () => adminGeneratorApi.fuelLogs(generatorId, month),
  });

  const [date, setDate] = useState(isoDate(new Date()));
  const [litres, setLitres] = useState("");
  const [price, setPrice] = useState("");
  const [isStock, setIsStock] = useState(false);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const l = Number(litres);
      const p = Number(price);
      if (!l || l <= 0) throw new Error("Enter valid litres");
      if (!p || p <= 0) throw new Error("Enter a valid price per litre (₹)");
      const body: LogInput = {
        type: "fuel",
        generatorId,
        date,
        litres: l,
        pricePerLitre: p,
        isStockPurchase: isStock,
        notes: notes.trim() || undefined,
      };
      await adminGeneratorApi.log(body);
    },
    onSuccess: () => {
      setLitres("");
      setPrice("");
      setNotes("");
      setErr(null);
      void qc.invalidateQueries({ queryKey: ["admin", "generator"] });
      void history.refetch();
    },
    onError: (e) => setErr(errMsg(e)),
  });

  const logs = history.data?.logs ?? [];

  return (
    <View style={{ gap: spacing["4"] }}>
      <Card style={{ padding: spacing["4"], gap: spacing["3"] }}>
        <Text variant="bodyStrong" color={colors.foreground}>
          Log fuel entry
        </Text>
        <Input label="Date" placeholder="YYYY-MM-DD" value={date} onChangeText={setDate} />
        <View style={styles.twoCol}>
          <View style={{ flex: 1 }}>
            <Input
              label="Litres"
              keyboardType="numeric"
              placeholder="10"
              value={litres}
              onChangeText={setLitres}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label="Price / litre (₹)"
              keyboardType="numeric"
              placeholder="95"
              value={price}
              onChangeText={setPrice}
            />
          </View>
        </View>
        <View style={styles.chipRow}>
          {[
            { v: false, label: "Filled in generator" },
            { v: true, label: "Bought into stock" },
          ].map((opt) => (
            <Pressable
              key={String(opt.v)}
              onPress={() => setIsStock(opt.v)}
              style={[styles.chip, isStock === opt.v && styles.chipActive]}
            >
              <Text
                variant="tiny"
                weight="600"
                color={isStock === opt.v ? colors.emerald400 : colors.zinc400}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Input label="Note (optional)" placeholder="…" value={notes} onChangeText={setNotes} />
        {litres && price ? (
          <Text variant="small" color={colors.zinc400}>
            Total: {formatRupees(Number(litres) * Number(price))}
          </Text>
        ) : null}
        {err ? (
          <Text variant="small" color={colors.destructive}>
            {err}
          </Text>
        ) : null}
        <Button label="Log fuel" onPress={() => save.mutate()} loading={save.isPending} fullWidth />
      </Card>

      <Card style={{ padding: spacing["4"], gap: spacing["2"] }}>
        <View style={styles.rowBetween}>
          <Text variant="bodyStrong" color={colors.foreground}>
            Fuel history
          </Text>
          <Input
            placeholder="YYYY-MM"
            value={month}
            onChangeText={setMonth}
            containerStyle={styles.monthInput}
          />
        </View>
        {history.isLoading ? (
          <Skeleton width="100%" height={40} />
        ) : logs.length === 0 ? (
          <Text variant="small" color={colors.zinc500}>
            No logs for this month
          </Text>
        ) : (
          logs.map((f) => (
            <View key={f.id} style={styles.histRow}>
              <View style={{ flex: 1 }}>
                <Text variant="small" color={colors.zinc300}>
                  {f.date.slice(0, 10)} · {f.litres} L @ {paiseToRupees(f.pricePerLitre)}/L
                  {f.isStockPurchase ? " (stock)" : ""}
                </Text>
                {f.notes ? (
                  <Text variant="tiny" color={colors.zinc500}>
                    {f.notes}
                  </Text>
                ) : null}
              </View>
              <Text variant="small" weight="600" color={colors.foreground}>
                {paiseToRupees(f.totalCost)}
              </Text>
            </View>
          ))
        )}
      </Card>
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
//  Oil tab — log form + full history
// ════════════════════════════════════════════════════════════════
function OilTab({ gen }: { gen: GeneratorDashboard }) {
  const qc = useQueryClient();
  const generatorId = gen.generator.id;

  const history = useQuery({
    queryKey: ["admin", "generator", "oil", generatorId],
    queryFn: () => adminGeneratorApi.oilChanges(generatorId),
  });

  const [date, setDate] = useState(isoDate(new Date()));
  const [litres, setLitres] = useState("1");
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const oilUrgent = gen.hoursUntilOilChange <= 10;
  const oilWarning = gen.hoursUntilOilChange <= 20;

  const save = useMutation({
    mutationFn: async () => {
      const l = Number(litres);
      const p = Number(price);
      if (!l || l <= 0) throw new Error("Enter valid litres");
      if (!p || p <= 0) throw new Error("Enter a valid cost per litre (₹)");
      const body: LogInput = {
        type: "oil",
        generatorId,
        date,
        litres: l,
        costPerLitre: p,
        notes: notes.trim() || undefined,
      };
      await adminGeneratorApi.log(body);
    },
    onSuccess: () => {
      setPrice("");
      setNotes("");
      setErr(null);
      void qc.invalidateQueries({ queryKey: ["admin", "generator"] });
      void history.refetch();
    },
    onError: (e) => setErr(errMsg(e)),
  });

  const changes = history.data?.changes ?? [];

  return (
    <View style={{ gap: spacing["4"] }}>
      <Card
        style={{
          padding: spacing["4"],
          gap: 4,
          ...(oilUrgent
            ? styles.alertUrgent
            : oilWarning
              ? styles.alertWarn
              : null),
        }}
      >
        <Text variant="bodyStrong" color={colors.foreground}>
          Next oil change: #{gen.totalOilChanges + 1}
        </Text>
        <Text variant="small" color={colors.zinc400}>
          Due at {gen.nextOilChangeAt} hr · now {gen.totalRunningHours} hr ·{" "}
          <Text
            variant="small"
            weight="700"
            color={oilUrgent ? colors.destructive : oilWarning ? colors.warning : colors.emerald400}
          >
            {gen.hoursUntilOilChange} hr left
          </Text>
        </Text>
      </Card>

      <Card style={{ padding: spacing["4"], gap: spacing["3"] }}>
        <Text variant="bodyStrong" color={colors.foreground}>
          Log oil change
        </Text>
        <Input label="Date" placeholder="YYYY-MM-DD" value={date} onChangeText={setDate} />
        <View style={styles.twoCol}>
          <View style={{ flex: 1 }}>
            <Input
              label="Oil litres"
              keyboardType="numeric"
              placeholder="1"
              value={litres}
              onChangeText={setLitres}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label="Cost / litre (₹)"
              keyboardType="numeric"
              placeholder="295"
              value={price}
              onChangeText={setPrice}
            />
          </View>
        </View>
        <Input label="Note (optional)" placeholder="…" value={notes} onChangeText={setNotes} />
        {litres && price ? (
          <Text variant="small" color={colors.zinc400}>
            Total: {formatRupees(Number(litres) * Number(price))} · at{" "}
            {gen.totalRunningHours} hr
          </Text>
        ) : null}
        {err ? (
          <Text variant="small" color={colors.destructive}>
            {err}
          </Text>
        ) : null}
        <Button
          label="Log oil change"
          onPress={() => save.mutate()}
          loading={save.isPending}
          fullWidth
        />
      </Card>

      <Card style={{ padding: spacing["4"], gap: spacing["2"] }}>
        <Text variant="bodyStrong" color={colors.foreground}>
          Oil change history
        </Text>
        {history.isLoading ? (
          <Skeleton width="100%" height={40} />
        ) : changes.length === 0 ? (
          <Text variant="small" color={colors.zinc500}>
            No oil changes logged
          </Text>
        ) : (
          changes.map((o) => (
            <View key={o.id} style={styles.histRow}>
              <View style={{ flex: 1 }}>
                <Text variant="small" color={colors.zinc300}>
                  #{o.sequenceNumber} · {o.date.slice(0, 10)} · {o.runningHoursAtChange} hr ·{" "}
                  {o.litres} L @ {paiseToRupees(o.costPerLitre)}/L
                </Text>
                {o.notes ? (
                  <Text variant="tiny" color={colors.zinc500}>
                    {o.notes}
                  </Text>
                ) : null}
              </View>
              <Text variant="small" weight="600" color={colors.foreground}>
                {paiseToRupees(o.totalCost)}
              </Text>
            </View>
          ))
        )}
      </Card>
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
//  Run log tab — start/stop timer + manual entry + history
// ════════════════════════════════════════════════════════════════
function RunLogTab({ gen }: { gen: GeneratorDashboard }) {
  const qc = useQueryClient();
  const generatorId = gen.generator.id;

  const history = useQuery({
    queryKey: ["admin", "generator", "run", generatorId],
    queryFn: () => adminGeneratorApi.runLogs(generatorId),
  });

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "generator"] });
    void history.refetch();
  };

  const start = useMutation({
    mutationFn: () => adminGeneratorApi.startRun(generatorId),
    onSuccess: refreshAll,
    onError: (e) => Alert.alert("Could not start", errMsg(e)),
  });
  const stop = useMutation({
    mutationFn: (id: string) => adminGeneratorApi.stopRun(id),
    onSuccess: refreshAll,
    onError: (e) => Alert.alert("Could not stop", errMsg(e)),
  });

  // manual entry
  const [date, setDate] = useState(isoDate(new Date()));
  const [hours, setHours] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const addManual = useMutation({
    mutationFn: async () => {
      const h = Number(hours);
      if (!h || h <= 0) throw new Error("Enter valid running hours");
      const body: LogInput = {
        type: "run",
        generatorId,
        date,
        durationHours: h,
        notes: notes.trim() || undefined,
      };
      await adminGeneratorApi.log(body);
    },
    onSuccess: () => {
      setHours("");
      setNotes("");
      setErr(null);
      refreshAll();
    },
    onError: (e) => setErr(errMsg(e)),
  });

  const active = gen.activeRunLog;
  const logs = history.data?.logs ?? [];

  return (
    <View style={{ gap: spacing["4"] }}>
      <Card style={{ padding: spacing["4"], gap: spacing["3"] }}>
        <Text variant="bodyStrong" color={colors.foreground}>
          Generator timer
        </Text>
        {active ? (
          <>
            <View style={styles.runningRow}>
              <View style={styles.runningDot} />
              <Text variant="small" color={colors.emerald400}>
                Running · started {new Date(active.startTime).toLocaleTimeString("en-IN")}
              </Text>
            </View>
            <Button
              label="Stop generator"
              variant="destructive"
              onPress={() => stop.mutate(active.id)}
              loading={stop.isPending}
              leadingIcon={<Square size={16} color={colors.destructive_300} />}
              fullWidth
            />
          </>
        ) : (
          <Button
            label="Start generator"
            onPress={() => start.mutate()}
            loading={start.isPending}
            leadingIcon={<Play size={16} color={colors.primaryForeground} />}
            fullWidth
          />
        )}
      </Card>

      <Card style={{ padding: spacing["4"], gap: spacing["3"] }}>
        <Text variant="bodyStrong" color={colors.foreground}>
          Manual entry
        </Text>
        <View style={styles.twoCol}>
          <View style={{ flex: 1 }}>
            <Input label="Date" placeholder="YYYY-MM-DD" value={date} onChangeText={setDate} />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label="Duration (hrs)"
              keyboardType="numeric"
              placeholder="2.5"
              value={hours}
              onChangeText={setHours}
            />
          </View>
        </View>
        <Input label="Note (optional)" placeholder="…" value={notes} onChangeText={setNotes} />
        {err ? (
          <Text variant="small" color={colors.destructive}>
            {err}
          </Text>
        ) : null}
        <Button
          label="Add manual entry"
          variant="secondary"
          onPress={() => addManual.mutate()}
          loading={addManual.isPending}
          leadingIcon={<Plus size={16} color={colors.foreground} />}
          fullWidth
        />
      </Card>

      <Card style={{ padding: spacing["4"], gap: spacing["2"] }}>
        <Text variant="bodyStrong" color={colors.foreground}>
          Run log history
        </Text>
        {history.isLoading ? (
          <Skeleton width="100%" height={40} />
        ) : logs.length === 0 ? (
          <Text variant="small" color={colors.zinc500}>
            No run logs recorded
          </Text>
        ) : (
          logs.map((r) => (
            <View key={r.id} style={styles.histRow}>
              <View style={{ flex: 1 }}>
                <Text variant="small" color={colors.zinc300}>
                  <Text variant="small" color={colors.zinc500}>
                    #{r.entryId ?? "-"} ·{" "}
                  </Text>
                  {new Date(r.startTime).toLocaleString("en-IN")}
                </Text>
                <Text variant="tiny" color={colors.zinc500}>
                  {r.source === "hardware" ? "Device" : "Web"} ·{" "}
                  {r.endTime
                    ? new Date(r.endTime).toLocaleString("en-IN")
                    : "Running…"}
                  {r.notes ? ` · ${r.notes}` : ""}
                </Text>
              </View>
              <Text variant="small" weight="600" color={colors.foreground}>
                {r.durationHours != null ? `${r.durationHours} hr` : "—"}
              </Text>
            </View>
          ))
        )}
      </Card>
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
//  Config tab — full singleton config editor
// ════════════════════════════════════════════════════════════════
function ConfigTab({ generators }: { generators: GeneratorDashboard[] }) {
  const qc = useQueryClient();
  const cfg = useQuery({
    queryKey: ["admin", "generator", "config"],
    queryFn: () => adminGeneratorApi.getConfig(),
  });

  const [form, setForm] = useState<Record<string, string>>({});
  const [loadedPin, setLoadedPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    const c = cfg.data?.config;
    if (!c) return;
    setForm({
      petrolPricePerLitre: String(c.petrolPricePerLitre / 100),
      oilPricePerLitre: String(c.oilPricePerLitre / 100),
      consumptionRate: String(c.consumptionRate),
      firstOilChangeHours: String(c.firstOilChangeHours),
      secondOilChangeHours: String(c.secondOilChangeHours),
      regularOilChangeHours: String(c.regularOilChangeHours),
      oilChangeAlertHours: String(c.oilChangeAlertHours),
      notificationEmails: c.notificationEmails,
      oilChangeTemplateId: c.oilChangeTemplateId,
      monthlyTemplateId: c.monthlyTemplateId,
      pinChangeTemplateId: c.pinChangeTemplateId,
      generatorPin: c.generatorPin,
      hardwareApiKey: c.hardwareApiKey,
    });
    setLoadedPin(c.generatorPin);
  }, [cfg.data]);

  const set = (k: string) => (v: string) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      if (!/^\d{6}$/.test(form.generatorPin || "")) {
        throw new Error("PIN must be exactly 6 digits");
      }
      const pinChanged = form.generatorPin !== loadedPin;
      await adminGeneratorApi.saveConfig({
        petrolPricePerLitre: Math.round(Number(form.petrolPricePerLitre) * 100),
        oilPricePerLitre: Math.round(Number(form.oilPricePerLitre) * 100),
        consumptionRate: Number(form.consumptionRate),
        firstOilChangeHours: parseInt(form.firstOilChangeHours, 10),
        secondOilChangeHours: parseInt(form.secondOilChangeHours, 10),
        regularOilChangeHours: parseInt(form.regularOilChangeHours, 10),
        oilChangeAlertHours: parseInt(form.oilChangeAlertHours, 10),
        notificationEmails: form.notificationEmails,
        oilChangeTemplateId: form.oilChangeTemplateId,
        monthlyTemplateId: form.monthlyTemplateId,
        pinChangeTemplateId: form.pinChangeTemplateId,
        generatorPin: form.generatorPin,
        hardwareApiKey: form.hardwareApiKey,
        pinChanged,
      });
      return pinChanged;
    },
    onSuccess: (pinChanged) => {
      setErr(null);
      setLoadedPin(form.generatorPin);
      setOk(pinChanged ? "Saved — PIN change email sent" : "Configuration saved");
      void qc.invalidateQueries({ queryKey: ["admin", "generator", "config"] });
      setTimeout(() => setOk(null), 4000);
    },
    onError: (e) => setErr(errMsg(e)),
  });

  if (cfg.isLoading) {
    return <Skeleton width="100%" height={300} />;
  }

  const first = parseInt(form.firstOilChangeHours || "0", 10) || 0;
  const second = parseInt(form.secondOilChangeHours || "0", 10) || 0;
  const regular = parseInt(form.regularOilChangeHours || "0", 10) || 0;
  const pinChanged = form.generatorPin !== loadedPin;

  return (
    <View style={{ gap: spacing["4"] }}>
      <Card style={{ padding: spacing["4"], gap: spacing["3"] }}>
        <SectionLabel>Pricing</SectionLabel>
        <View style={styles.twoCol}>
          <View style={{ flex: 1 }}>
            <Input
              label="Petrol ₹/L"
              keyboardType="numeric"
              value={form.petrolPricePerLitre}
              onChangeText={set("petrolPricePerLitre")}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label="Oil ₹/L"
              keyboardType="numeric"
              value={form.oilPricePerLitre}
              onChangeText={set("oilPricePerLitre")}
            />
          </View>
        </View>
        <Input
          label="Consumption rate (L/hr)"
          keyboardType="numeric"
          value={form.consumptionRate}
          onChangeText={set("consumptionRate")}
        />
      </Card>

      <Card style={{ padding: spacing["4"], gap: spacing["3"] }}>
        <SectionLabel>Oil change schedule</SectionLabel>
        <View style={styles.twoCol}>
          <View style={{ flex: 1 }}>
            <Input
              label="First (hrs)"
              keyboardType="numeric"
              value={form.firstOilChangeHours}
              onChangeText={set("firstOilChangeHours")}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label="Second (+hrs)"
              keyboardType="numeric"
              value={form.secondOilChangeHours}
              onChangeText={set("secondOilChangeHours")}
            />
          </View>
        </View>
        <Input
          label="Regular interval (hrs)"
          keyboardType="numeric"
          value={form.regularOilChangeHours}
          onChangeText={set("regularOilChangeHours")}
        />
        <Text variant="tiny" color={colors.zinc500}>
          Preview: 1st at {first} hr, 2nd at {first + second} hr, then every{" "}
          {regular} hr ({first + second + regular}, {first + second + 2 * regular}, …)
        </Text>
        <Input
          label="Alert threshold (hrs before due)"
          keyboardType="numeric"
          value={form.oilChangeAlertHours}
          onChangeText={set("oilChangeAlertHours")}
        />
      </Card>

      <Card style={{ padding: spacing["4"], gap: spacing["3"] }}>
        <SectionLabel>Notifications</SectionLabel>
        <Input
          label="Notification emails (comma-separated)"
          value={form.notificationEmails}
          onChangeText={set("notificationEmails")}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
        />
        <Input
          label="Oil change template ID"
          value={form.oilChangeTemplateId}
          onChangeText={set("oilChangeTemplateId")}
          autoCapitalize="none"
        />
        <Input
          label="Monthly summary template ID"
          value={form.monthlyTemplateId}
          onChangeText={set("monthlyTemplateId")}
          autoCapitalize="none"
        />
        <Input
          label="PIN change template ID"
          value={form.pinChangeTemplateId}
          onChangeText={set("pinChangeTemplateId")}
          autoCapitalize="none"
        />
      </Card>

      <Card style={{ padding: spacing["4"], gap: spacing["3"] }}>
        <SectionLabel>Mobile access PIN</SectionLabel>
        <Input
          label="6-digit PIN"
          keyboardType="number-pad"
          maxLength={6}
          value={form.generatorPin}
          onChangeText={(v) => set("generatorPin")(v.replace(/\D/g, "").slice(0, 6))}
        />
        <Text variant="tiny" color={colors.zinc500}>
          Required for the mobile Start/Stop and Fuel Log pages.
        </Text>
        {pinChanged ? (
          <Text variant="tiny" color={colors.warning}>
            PIN changed — an email notification will be sent on save.
          </Text>
        ) : null}
        <View style={{ gap: 2 }}>
          {generators.map((g) => (
            <Text key={g.generator.id} variant="tiny" color={colors.zinc500}>
              {g.generator.name}: /generator/run/{g.generator.id}
            </Text>
          ))}
        </View>
      </Card>

      <Card style={{ padding: spacing["4"], gap: spacing["3"] }}>
        <SectionLabel>Hardware API</SectionLabel>
        <Input
          label="API key (x-api-key)"
          value={form.hardwareApiKey}
          onChangeText={set("hardwareApiKey")}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text variant="tiny" color={colors.zinc500}>
          POST /api/generator/bulk-log — used by hardware devices.
        </Text>
      </Card>

      {err ? (
        <Text variant="small" color={colors.destructive}>
          {err}
        </Text>
      ) : null}
      {ok ? (
        <Text variant="small" color={colors.emerald400}>
          {ok}
        </Text>
      ) : null}
      <Button
        label="Save configuration"
        onPress={() => save.mutate()}
        loading={save.isPending}
        leadingIcon={<Settings size={16} color={colors.primaryForeground} />}
        fullWidth
        size="lg"
      />
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
//  Analytics tab
// ════════════════════════════════════════════════════════════════
function AnalyticsTab({ gen }: { gen: GeneratorDashboard }) {
  const generatorId = gen.generator.id;
  const now = new Date();
  const [from, setFrom] = useState(isoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 1)));

  const q = useQuery<GeneratorAnalytics>({
    queryKey: ["admin", "generator", "analytics", generatorId, from, to],
    queryFn: () => adminGeneratorApi.analytics(generatorId, { from, to }),
  });

  const d = q.data;

  return (
    <View style={{ gap: spacing["4"] }}>
      <Card style={{ padding: spacing["4"], gap: spacing["3"] }}>
        <View style={styles.twoCol}>
          <View style={{ flex: 1 }}>
            <Input label="From" placeholder="YYYY-MM-DD" value={from} onChangeText={setFrom} />
          </View>
          <View style={{ flex: 1 }}>
            <Input label="To" placeholder="YYYY-MM-DD" value={to} onChangeText={setTo} />
          </View>
        </View>
        <Button
          label="Load analytics"
          variant="secondary"
          onPress={() => void q.refetch()}
          loading={q.isFetching}
          leadingIcon={<BarChart3 size={16} color={colors.foreground} />}
          fullWidth
        />
      </Card>

      {q.isLoading ? (
        <Skeleton width="100%" height={120} />
      ) : d ? (
        <>
          <View style={styles.statGrid}>
            <Stat
              icon={<Timer size={14} color={colors.emerald400} />}
              label="Total hours"
              value={`${d.totalHours} hr`}
            />
            <Stat
              icon={<Fuel size={14} color={colors.yellow400} />}
              label="Fuel cost"
              value={paiseToRupees(d.totalFuelCost)}
            />
            <Stat
              icon={<Droplet size={14} color={colors.warning} />}
              label="Oil cost"
              value={paiseToRupees(d.totalOilCost)}
              sub={`${d.oilChangesInPeriod} changes`}
            />
            <Stat
              icon={<BarChart3 size={14} color={colors.yellow400} />}
              label="Cost / booking hr"
              value={d.costPerBookingHour > 0 ? paiseToRupees(d.costPerBookingHour) : "N/A"}
            />
          </View>

          <Card style={{ padding: spacing["4"], gap: spacing["2"] }}>
            <Text variant="bodyStrong" color={colors.foreground}>
              Period summary
            </Text>
            <View style={styles.rowBetween}>
              <Text variant="small" color={colors.zinc500}>
                Total litres
              </Text>
              <Text variant="small" color={colors.zinc300}>
                {d.totalLitres} L
              </Text>
            </View>
            <View style={styles.rowBetween}>
              <Text variant="small" color={colors.zinc500}>
                Total cost
              </Text>
              <Text variant="small" weight="700" color={colors.foreground}>
                {paiseToRupees(d.totalCost)}
              </Text>
            </View>
          </Card>

          {d.monthlyBreakdown.length > 0 ? (
            <Card style={{ padding: spacing["4"], gap: spacing["2"] }}>
              <Text variant="bodyStrong" color={colors.foreground}>
                Monthly breakdown
              </Text>
              {d.monthlyBreakdown.map((m) => (
                <View key={m.month} style={styles.histRow}>
                  <View style={{ flex: 1 }}>
                    <Text variant="small" color={colors.zinc300}>
                      {m.month} · {m.hours} hr · {m.litres} L
                    </Text>
                    <Text variant="tiny" color={colors.zinc500}>
                      fuel {paiseToRupees(m.fuelCost)} · oil {paiseToRupees(m.oilCost)}
                    </Text>
                  </View>
                  <Text variant="small" weight="600" color={colors.foreground}>
                    {paiseToRupees(m.totalCost)}
                  </Text>
                </View>
              ))}
            </Card>
          ) : null}
        </>
      ) : (
        <Text variant="small" color={colors.zinc500}>
          No analytics for this range.
        </Text>
      )}
    </View>
  );
}

// ─── small shared components ───────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text variant="tiny" weight="700" color={colors.zinc500} style={styles.sectionLabel}>
      {String(children).toUpperCase()}
    </Text>
  );
}

function Stat({
  icon,
  label,
  value,
  valueColor,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor?: string;
  sub?: string;
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
      {sub ? (
        <Text variant="tiny" color={colors.zinc600}>
          {sub}
        </Text>
      ) : null}
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
  topRow: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  genChips: { gap: spacing["2"], paddingRight: spacing["2"] },
  genChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  genChipActive: { borderColor: colors.emerald400, backgroundColor: colors.emerald500_10 },
  addBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  tabBar: { gap: spacing["1"], paddingRight: spacing["2"] },
  tab: {
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    borderRadius: radius.md,
  },
  tabActive: { backgroundColor: colors.zinc800 },
  list: { gap: spacing["3"] },
  empty: { alignItems: "center", paddingVertical: spacing["12"] },
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
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing["2"],
  },
  histRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing["3"],
    paddingVertical: spacing["2"],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.zinc800,
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.zinc800,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 999 },
  alertUrgent: { borderWidth: 1, borderColor: colors.destructive_30, backgroundColor: colors.destructive_10 },
  alertWarn: { borderWidth: 1, borderColor: colors.yellow500_30, backgroundColor: colors.yellow500_10 },
  runningRow: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  runningDot: { width: 10, height: 10, borderRadius: 999, backgroundColor: colors.emerald400 },
  twoCol: { flexDirection: "row", gap: spacing["3"] },
  chipRow: { flexDirection: "row", gap: spacing["2"] },
  chip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  chipActive: { borderColor: colors.emerald400, backgroundColor: colors.emerald500_10 },
  monthInput: { width: 120, marginBottom: 0 },
  sectionLabel: { letterSpacing: 1.2 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
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
});
