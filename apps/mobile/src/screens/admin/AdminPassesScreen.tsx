import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { AdminMoreStackParamList } from "../../navigation/types";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Gift,
  Minus,
  Plus,
  Ticket,
  Trash2,
  Users,
  X,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, spacing } from "../../theme";
import { formatRupees } from "../../lib/format";
import {
  adminPassesApi,
  bandKey,
  bandLabel,
  type AdminPassPlan,
  type Band,
  type PassConfigOption,
  type SoldPass,
} from "../../lib/admin-passes";
import { adminBookingsApi } from "../../lib/admin-bookings";
import { AdminApiError } from "../../lib/admin-api";

/**
 * Mobile admin passes hub — full parity with web /admin/passes:
 * Plans (storefront switch + band-scoped plan wizard), Sold (issue /
 * gift / extend / adjust / cancel / members), Sharing (per-court-group
 * member caps).
 */

const fmtH = (m: number) => `${(m / 60).toFixed(1).replace(/\.0$/, "")}h`;
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
const todayIso = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: colors.emerald400,
  UPCOMING: "#7dd3fc",
  EXHAUSTED: colors.zinc400,
  EXPIRED: "#fbbf24",
  CANCELLED: "#f87171",
};

function errMsg(e: unknown): string {
  return e instanceof AdminApiError || e instanceof Error
    ? e.message
    : "Something went wrong";
}

// ── Band grid — same-price selection, mirrors the web BandPicker ────
function BandGrid({
  config,
  selected,
  onToggle,
}: {
  config: PassConfigOption;
  selected: Band[];
  onToggle: (b: Band) => void;
}) {
  // Selected bands all share one price (enforced here like the web
  // wizard): once one cell is picked, cells at other prices disable.
  const selectedKeys = new Set(selected.map(bandKey));
  const priceOf = (b: Band) =>
    config.rates.find((r) => r.dayType === b.dayType && r.timeType === b.timeType)
      ?.pricePerSlot ?? null;
  const anchor = selected.length > 0 ? priceOf(selected[0]) : null;

  const cells: Band[] = (["WEEKDAY", "WEEKEND"] as const).flatMap((d) =>
    (["OFF_PEAK", "PEAK"] as const).map((t) => ({ dayType: d, timeType: t })),
  );

  return (
    <View style={styles.bandGrid}>
      {cells.map((b) => {
        const price = priceOf(b);
        if (price == null) return null;
        const on = selectedKeys.has(bandKey(b));
        const disabled = !on && anchor != null && price !== anchor;
        return (
          <Pressable
            key={bandKey(b)}
            onPress={() => !disabled && onToggle(b)}
            style={[
              styles.bandCell,
              on && styles.bandCellOn,
              disabled && { opacity: 0.35 },
            ]}
          >
            <Text style={[styles.bandCellLabel, on && { color: "#6ee7b7" }]}>
              {bandLabel(b)}
            </Text>
            <Text style={[styles.bandCellPrice, on && { color: "#6ee7b7" }]}>
              {formatRupees(price)}/slot
            </Text>
          </Pressable>
        );
      })}
      <Text style={styles.bandHint}>
        Pick the pricing cells this pass covers — all selected cells must
        share one price (that price becomes the anchor).
      </Text>
    </View>
  );
}

// ── Customer search (issue / gift) ──────────────────────────────────
interface PickedCustomer {
  id: string;
  name: string | null;
  phone: string | null;
}

function CustomerSearch({
  picked,
  onPick,
}: {
  picked: PickedCustomer | null;
  onPick: (c: PickedCustomer | null) => void;
}) {
  const [q, setQ] = useState("");
  const search = useQuery({
    queryKey: ["admin", "pass-customer-search", q],
    queryFn: () => adminBookingsApi.searchCustomers(q),
    enabled: q.trim().length >= 2 && !picked,
  });

  if (picked) {
    return (
      <View style={styles.pickedRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.pickedName}>{picked.name ?? "Customer"}</Text>
          <Text style={styles.pickedPhone}>{picked.phone ?? "—"}</Text>
        </View>
        <Pressable onPress={() => onPick(null)} hitSlop={8}>
          <X size={16} color={colors.zinc400} />
        </Pressable>
      </View>
    );
  }
  return (
    <View>
      <Input
        placeholder="Search customer by name / phone"
        value={q}
        onChangeText={setQ}
        autoCapitalize="none"
      />
      {search.isFetching ? (
        <ActivityIndicator size="small" color={colors.zinc500} style={{ marginTop: 8 }} />
      ) : null}
      {(search.data?.customers ?? []).slice(0, 6).map((c) => (
        <Pressable
          key={c.id}
          onPress={() => onPick({ id: c.id, name: c.name, phone: c.phone })}
          style={styles.searchRow}
        >
          <Text style={styles.pickedName}>{c.name ?? "—"}</Text>
          <Text style={styles.pickedPhone}>{c.phone ?? c.email ?? ""}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ── Bottom-sheet modal chrome (shared by all the forms) ─────────────
function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={20} color={colors.zinc400} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.sheetBody}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function AdminPassesScreen() {
  const qc = useQueryClient();
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "passes"],
    queryFn: () => adminPassesApi.data(),
  });

  const navigation =
    useNavigation<NativeStackNavigationProp<AdminMoreStackParamList>>();
  const [tab, setTab] = useState<"plans" | "sold" | "issue" | "sharing">("plans");
  const [busy, setBusy] = useState(false);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin", "passes"] });

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) Alert.alert("Couldn't save", res.error ?? "Try again.");
      refresh();
      return res.ok;
    } catch (e) {
      Alert.alert("Couldn't save", errMsg(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  // ── Plan form state (create + edit share the sheet) ──
  const [planForm, setPlanForm] = useState<{
    editing: AdminPassPlan | null;
    configId: string;
    hours: string;
    discount: string;
    validity: string;
    name: string;
    bands: Band[];
  } | null>(null);

  // ── Sold-pass action sheets ──
  const [issueOpen, setIssueOpen] = useState(false);
  const [giftOpen, setGiftOpen] = useState(false);
  const [membersFor, setMembersFor] = useState<SoldPass | null>(null);
  const [amountFor, setAmountFor] = useState<{
    pass: SoldPass;
    kind: "extend" | "adjust";
    value: string;
  } | null>(null);

  const configs = useMemo(() => data?.configs ?? [], [data?.configs]);
  const plans = data?.plans ?? [];
  const sold = data?.sold ?? [];
  const configById = useMemo(
    () => new Map(configs.map((c) => [c.id, c])),
    [configs],
  );

  function openCreatePlan() {
    if (configs.length === 0) return;
    setPlanForm({
      editing: null,
      configId: configs[0].id,
      hours: "10",
      discount: "10",
      validity: "30",
      name: "",
      bands: [],
    });
  }
  function openEditPlan(p: AdminPassPlan) {
    setPlanForm({
      editing: p,
      configId: p.courtConfigId,
      hours: String(p.totalMinutes / 60),
      discount: String(p.discountPercent),
      validity: String(p.validityDays),
      name: p.name,
      bands: p.bands,
    });
  }

  async function submitPlanForm() {
    if (!planForm) return;
    const input = {
      totalHours: Number(planForm.hours),
      bands: planForm.bands,
      discountPercent: Number(planForm.discount),
      validityDays: Number(planForm.validity),
      name: planForm.name.trim() || undefined,
    };
    const ok = await run(() =>
      planForm.editing
        ? adminPassesApi.updatePlan(planForm.editing.id, input)
        : adminPassesApi.createPlan({
            ...input,
            courtConfigId: planForm.configId,
          }),
    );
    if (ok) setPlanForm(null);
  }

  async function submitAmount() {
    if (!amountFor) return;
    const n = Number(amountFor.value);
    const ok = await run(() =>
      amountFor.kind === "extend"
        ? adminPassesApi.extend(amountFor.pass.id, n)
        : // Adjust is entered in HOURS (can be negative); server takes minutes.
          adminPassesApi.adjustMinutes(amountFor.pass.id, Math.round(n * 60)),
    );
    if (ok) setAmountFor(null);
  }

  function confirmCancel(p: SoldPass) {
    Alert.alert(
      "Cancel this pass?",
      `${p.name} (${p.customer}) — cancellation is terminal; remaining hours are void. Refunds stay manual.`,
      [
        { text: "Keep pass", style: "cancel" },
        {
          text: "Cancel pass",
          style: "destructive",
          onPress: () => void run(() => adminPassesApi.cancel(p.id)),
        },
      ],
    );
  }

  function confirmDeletePlan(p: AdminPassPlan) {
    Alert.alert("Delete plan?", `${p.name} — only possible with zero sold passes.`, [
      { text: "Keep", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void run(() => adminPassesApi.deletePlan(p.id)),
      },
    ]);
  }

  if (isLoading || !data) {
    return (
      <Screen>
        <View style={{ gap: spacing["3"] }}>
          <Skeleton height={40} />
          <Skeleton height={120} />
          <Skeleton height={120} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.emerald400}
          />
        }
      >
        {/* Tabs */}
        <View style={styles.tabsRow}>
          {(
            [
              { key: "plans", label: `Plans (${plans.length})` },
              { key: "sold", label: `Sold (${sold.length})` },
              // Web splits Issue onto its own tab and calls the last one
              // Settings — match that so the two admins read the same.
              { key: "issue", label: "Issue" },
              { key: "sharing", label: "Settings" },
            ] as const
          ).map((t) => (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[styles.tabBtn, tab === t.key && styles.tabBtnOn]}
            >
              <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* ── PLANS ── */}
        {tab === "plans" && (
          <View style={styles.stack}>
            <View style={styles.switchCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchTitle}>Storefront</Text>
                <Text style={styles.switchSub}>
                  OFF hides all plans from customers; sold passes keep
                  redeeming.
                </Text>
              </View>
              <Switch
                value={data.enabled}
                onValueChange={(v) => void run(() => adminPassesApi.setEnabled(v))}
                trackColor={{ true: colors.emerald500, false: colors.zinc700 }}
              />
            </View>

            <Button
              label="New plan"
              leadingIcon={<Plus size={16} color="#022c22" />}
              onPress={openCreatePlan}
            />

            {plans.map((p) => (
              <View key={p.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {p.name}
                  </Text>
                  <Switch
                    value={p.isActive}
                    onValueChange={(v) =>
                      void run(() => adminPassesApi.togglePlan(p.id, v))
                    }
                    trackColor={{ true: colors.emerald500, false: colors.zinc700 }}
                  />
                </View>
                <Text style={styles.cardMeta}>
                  {configById.get(p.courtConfigId)?.label ?? p.sport} ·{" "}
                  {fmtH(p.totalMinutes)} · {p.validityDays} days
                </Text>
                <Text style={styles.cardMeta}>
                  {formatRupees(p.price)}
                  {p.baseAmount > p.price
                    ? `  (base ${formatRupees(p.baseAmount)}, save ${p.discountPercent}%)`
                    : ""}
                  {" · "}
                  {p.soldCount} sold
                </Text>
                {p.bands.length > 0 ? (
                  <Text style={styles.cardBands}>
                    {p.bands.map(bandLabel).join(", ")}
                  </Text>
                ) : (
                  <Text style={styles.cardBands}>All hours (legacy)</Text>
                )}
                {!p.pricingValid && (
                  <Text style={styles.warnText}>
                    ⚠︎ Price drifted off the anchor — unsellable until edited.
                  </Text>
                )}
                {/* Cheapest pass — exactly one per court group; its
                    effective hourly rate becomes the slot page's
                    "Book from just ₹X/hour" price. Ticking replaces the
                    group's current holder. */}
                <View style={styles.anchorRow}>
                  <Pressable
                    disabled={!p.isActive && !p.isCheapestHourAnchor}
                    onPress={() =>
                      void run(() =>
                        adminPassesApi.setCheapestHour(
                          p.id,
                          !p.isCheapestHourAnchor,
                        ),
                      )
                    }
                    style={[
                      styles.anchorChip,
                      p.isCheapestHourAnchor && styles.anchorChipOn,
                      !p.isActive && !p.isCheapestHourAnchor && { opacity: 0.35 },
                    ]}
                  >
                    <Text
                      variant="tiny"
                      weight="700"
                      color={
                        p.isCheapestHourAnchor ? colors.emerald400 : colors.zinc500
                      }
                    >
                      {p.isCheapestHourAnchor ? "✓ " : ""}Cheapest pass
                    </Text>
                  </Pressable>
                </View>
                <View style={styles.cardActions}>
                  <Button
                    label="Edit"
                    variant="secondary"
                    size="sm"
                    onPress={() => openEditPlan(p)}
                  />
                  {p.soldCount === 0 && (
                    <Button
                      label="Delete"
                      variant="destructive"
                      size="sm"
                      leadingIcon={<Trash2 size={14} color="#fff" />}
                      onPress={() => confirmDeletePlan(p)}
                    />
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ── SOLD ── */}
        {tab === "issue" && (
          <View style={styles.stack}>
            <Text style={styles.emptyText}>
              Sell a pass at the venue, or gift a custom one. Issued passes
              appear under Sold.
            </Text>
            <View style={styles.rowButtons}>
              <Button
                label="Issue pass"
                leadingIcon={<Ticket size={15} color="#022c22" />}
                onPress={() => setIssueOpen(true)}
                style={{ flex: 1 }}
              />
              <Button
                label="Gift pass"
                variant="secondary"
                leadingIcon={<Gift size={15} color={colors.foreground} />}
                onPress={() => setGiftOpen(true)}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        )}

        {tab === "sold" && (
          <View style={styles.stack}>
            {sold.length === 0 && (
              <Text style={styles.emptyText}>No passes sold yet.</Text>
            )}
            {sold.map((p) => {
              const cancelled = p.status === "CANCELLED";
              return (
                <View key={p.id} style={styles.card}>
                  {/* Only the info block is tappable — the action buttons
                      below stay independent, so opening the detail screen
                      can never fire an Extend/Cancel by accident. */}
                  <Pressable
                    onPress={() =>
                      navigation.navigate("AdminPassDetail", { passId: p.id })
                    }
                    style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
                  >
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle} numberOfLines={2}>
                      {p.name}
                    </Text>
                    <Text
                      style={[
                        styles.statusText,
                        { color: STATUS_COLOR[p.status] ?? colors.zinc400 },
                      ]}
                    >
                      {p.status}
                    </Text>
                  </View>
                  <Text style={styles.cardMeta}>
                    {p.customer} · {p.phone}
                  </Text>
                  <Text style={styles.cardMeta}>
                    {fmtH(p.remainingMinutes)} of {fmtH(p.totalMinutes)} left ·{" "}
                    {formatRupees(p.price)} · {p.method}
                  </Text>
                  <Text style={styles.cardMeta}>
                    {p.status === "UPCOMING"
                      ? `Starts ${fmtDate(p.startsAt)}`
                      : `Expires ${fmtDate(p.expiresAt)}`}
                    {" · "}
                    {p.redemptionCount} booking{p.redemptionCount === 1 ? "" : "s"}
                    {p.memberCount > 0
                      ? ` · ${p.memberCount} member${p.memberCount === 1 ? "" : "s"}`
                      : ""}
                  </Text>
                  </Pressable>
                  {!cancelled && (
                    <View style={styles.cardActions}>
                      <Button
                        label="Extend"
                        variant="secondary"
                        size="sm"
                        onPress={() =>
                          setAmountFor({ pass: p, kind: "extend", value: "30" })
                        }
                      />
                      <Button
                        label="± Hours"
                        variant="secondary"
                        size="sm"
                        onPress={() =>
                          setAmountFor({ pass: p, kind: "adjust", value: "1" })
                        }
                      />
                      <Button
                        label="Members"
                        variant="secondary"
                        size="sm"
                        leadingIcon={<Users size={13} color={colors.foreground} />}
                        onPress={() => setMembersFor(p)}
                      />
                      <Button
                        label="Cancel"
                        variant="destructive"
                        size="sm"
                        onPress={() => confirmCancel(p)}
                      />
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* ── SHARING ── */}
        {tab === "sharing" && (
          <View style={styles.stack}>
            <Text style={styles.emptyText}>
              Max additional members a pass on each court group can be shared
              with (0 = sharing off). Applies to every pass on the group.
            </Text>
            {configs.map((c) => (
              <View key={c.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{c.label}</Text>
                </View>
                <View style={styles.stepperRow}>
                  <Pressable
                    onPress={() =>
                      c.maxPassMembers > 0 &&
                      void run(() =>
                        adminPassesApi.setSharing(c.id, c.maxPassMembers - 1),
                      )
                    }
                    disabled={busy || c.maxPassMembers <= 0}
                    style={styles.stepBtn}
                  >
                    <Minus size={16} color={colors.foreground} />
                  </Pressable>
                  <Text style={styles.stepValue}>
                    {c.maxPassMembers} member{c.maxPassMembers === 1 ? "" : "s"}
                  </Text>
                  <Pressable
                    onPress={() =>
                      c.maxPassMembers < 30 &&
                      void run(() =>
                        adminPassesApi.setSharing(c.id, c.maxPassMembers + 1),
                      )
                    }
                    disabled={busy || c.maxPassMembers >= 30}
                    style={styles.stepBtn}
                  >
                    <Plus size={16} color={colors.foreground} />
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* ── Plan create / edit sheet ── */}
      {planForm && (
        <Sheet
          title={planForm.editing ? "Edit plan" : "New plan"}
          onClose={() => setPlanForm(null)}
        >
          {!planForm.editing && (
            <>
              <Text style={styles.fieldLabel}>Court group</Text>
              <View style={styles.chipsWrap}>
                {configs.map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() =>
                      setPlanForm({ ...planForm, configId: c.id, bands: [] })
                    }
                    style={[
                      styles.chip,
                      planForm.configId === c.id && styles.chipOn,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        planForm.configId === c.id && styles.chipTextOn,
                      ]}
                    >
                      {c.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {(() => {
            const cfg = configById.get(planForm.configId);
            return cfg ? (
              <BandGrid
                config={cfg}
                selected={planForm.bands}
                onToggle={(b) => {
                  const k = bandKey(b);
                  const has = planForm.bands.some((x) => bandKey(x) === k);
                  setPlanForm({
                    ...planForm,
                    bands: has
                      ? planForm.bands.filter((x) => bandKey(x) !== k)
                      : [...planForm.bands, b],
                  });
                }}
              />
            ) : null;
          })()}

          <Input
            label="Hours"
            keyboardType="decimal-pad"
            value={planForm.hours}
            onChangeText={(t) => setPlanForm({ ...planForm, hours: t })}
          />
          <Input
            label="Discount %"
            keyboardType="number-pad"
            value={planForm.discount}
            onChangeText={(t) => setPlanForm({ ...planForm, discount: t })}
          />
          <Input
            label="Validity (days)"
            keyboardType="number-pad"
            value={planForm.validity}
            onChangeText={(t) => setPlanForm({ ...planForm, validity: t })}
          />
          <Input
            label="Name (optional — auto-generated when blank)"
            value={planForm.name}
            onChangeText={(t) => setPlanForm({ ...planForm, name: t })}
          />
          <Button
            label={planForm.editing ? "Save changes" : "Create plan"}
            loading={busy}
            onPress={() => void submitPlanForm()}
            fullWidth
          />
        </Sheet>
      )}

      {/* ── Extend / adjust sheet ── */}
      {amountFor && (
        <Sheet
          title={
            amountFor.kind === "extend"
              ? `Extend — ${amountFor.pass.name}`
              : `Adjust hours — ${amountFor.pass.name}`
          }
          onClose={() => setAmountFor(null)}
        >
          <Input
            label={
              amountFor.kind === "extend"
                ? "Extra days (1–365)"
                : "Hours delta (e.g. 2 or -1.5)"
            }
            keyboardType="numbers-and-punctuation"
            value={amountFor.value}
            onChangeText={(t) => setAmountFor({ ...amountFor, value: t })}
          />
          <Button
            label="Apply"
            loading={busy}
            onPress={() => void submitAmount()}
            fullWidth
          />
        </Sheet>
      )}

      {/* ── Members sheet ── */}
      {membersFor && (
        <MembersSheet
          pass={membersFor}
          onClose={() => {
            setMembersFor(null);
            refresh();
          }}
        />
      )}

      {/* ── Issue sheet ── */}
      {issueOpen && (
        <IssueSheet
          plans={plans.filter((p) => p.isActive && p.pricingValid)}
          busy={busy}
          run={run}
          onClose={() => setIssueOpen(false)}
        />
      )}

      {/* ── Gift sheet ── */}
      {giftOpen && (
        <GiftSheet
          configs={configs}
          busy={busy}
          run={run}
          onClose={() => setGiftOpen(false)}
        />
      )}
    </Screen>
  );
}

// ── Members sheet (admin roster mirror of the web Members modal) ────
function MembersSheet({ pass, onClose }: { pass: SoldPass; onClose: () => void }) {
  const { data, refetch, isLoading } = useQuery({
    queryKey: ["admin", "pass-members", pass.id],
    queryFn: () => adminPassesApi.members(pass.id),
  });
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!phone.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminPassesApi.addMember(pass.id, phone.trim());
      if (res.ok) {
        setPhone("");
        void refetch();
      } else {
        setError(
          res.notRegistered
            ? `${res.error} Ask them to sign up first.`
            : res.error ?? "Couldn't add.",
        );
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={`Members — ${pass.name}`} onClose={onClose}>
      {isLoading || !data ? (
        <ActivityIndicator color={colors.emerald400} />
      ) : (
        <>
          <Text style={styles.cardMeta}>
            Owner: {data.owner.name ?? "—"} ({data.owner.phone ?? "—"}) · cap{" "}
            {data.maxMembers}
          </Text>
          {data.members.map((m) => (
            <View key={m.userId} style={styles.memberRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.pickedName}>{m.name ?? "Member"}</Text>
                <Text style={styles.pickedPhone}>
                  {m.phone ? `+${m.phone}` : "—"}
                </Text>
              </View>
              <Pressable
                onPress={() =>
                  Alert.alert("Remove member?", m.name ?? "This member", [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Remove",
                      style: "destructive",
                      onPress: async () => {
                        await adminPassesApi
                          .removeMember(pass.id, m.userId)
                          .catch(() => {});
                        void refetch();
                      },
                    },
                  ])
                }
                hitSlop={8}
              >
                <Trash2 size={15} color="#f87171" />
              </Pressable>
            </View>
          ))}
          {data.members.length === 0 && (
            <Text style={styles.emptyText}>No members yet.</Text>
          )}
          <Input
            placeholder="Add by 10-digit mobile number"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={(t) => {
              setPhone(t);
              setError(null);
            }}
          />
          {error ? <Text style={styles.warnText}>{error}</Text> : null}
          <Button
            label="Add member"
            loading={busy}
            disabled={!phone.trim()}
            onPress={() => void add()}
            fullWidth
          />
        </>
      )}
    </Sheet>
  );
}

// ── Issue sheet (offline sale at the venue) ─────────────────────────
function IssueSheet({
  plans,
  busy,
  run,
  onClose,
}: {
  plans: AdminPassPlan[];
  busy: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => Promise<boolean>;
  onClose: () => void;
}) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [method, setMethod] = useState<"CASH" | "UPI_QR" | "FREE">("CASH");
  const [amount, setAmount] = useState("");
  const [ref, setRef] = useState("");
  const [startDate, setStartDate] = useState(todayIso());

  const plan = plans.find((p) => p.id === planId) ?? null;

  async function submit() {
    if (!plan || !customer) return;
    const ok = await run(() =>
      adminPassesApi.issue({
        planId: plan.id,
        userId: customer.id,
        paymentMethod: method,
        amountCollected:
          method !== "FREE" && amount.trim() !== ""
            ? Number(amount)
            : undefined,
        offlineRef: ref.trim() || undefined,
        startDate,
      }),
    );
    if (ok) onClose();
  }

  return (
    <Sheet title="Issue pass at venue" onClose={onClose}>
      <Text style={styles.fieldLabel}>Plan</Text>
      <View style={styles.chipsWrap}>
        {plans.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => setPlanId(p.id)}
            style={[styles.chip, planId === p.id && styles.chipOn]}
          >
            <Text style={[styles.chipText, planId === p.id && styles.chipTextOn]}>
              {p.name} · {formatRupees(p.price)}
            </Text>
          </Pressable>
        ))}
      </View>
      {plans.length === 0 && (
        <Text style={styles.warnText}>No active sellable plans.</Text>
      )}

      <Text style={styles.fieldLabel}>Customer</Text>
      <CustomerSearch picked={customer} onPick={setCustomer} />

      <Text style={styles.fieldLabel}>Paid via</Text>
      <View style={styles.chipsWrap}>
        {(["CASH", "UPI_QR", "FREE"] as const).map((m) => (
          <Pressable
            key={m}
            onPress={() => setMethod(m)}
            style={[styles.chip, method === m && styles.chipOn]}
          >
            <Text style={[styles.chipText, method === m && styles.chipTextOn]}>
              {m === "CASH" ? "Cash" : m === "UPI_QR" ? "Static QR" : "Free"}
            </Text>
          </Pressable>
        ))}
      </View>

      {method !== "FREE" && (
        <Input
          label={`Amount collected (blank = plan price${plan ? ` ${formatRupees(plan.price)}` : ""})`}
          keyboardType="number-pad"
          value={amount}
          onChangeText={setAmount}
        />
      )}
      <Input
        label="Reference / note (optional — UTR, receipt no.)"
        value={ref}
        onChangeText={setRef}
      />
      <Input
        label="Start date (YYYY-MM-DD, today → +90d)"
        autoCapitalize="none"
        value={startDate}
        onChangeText={setStartDate}
      />
      <Button
        label="Issue pass"
        loading={busy}
        disabled={!plan || !customer}
        onPress={() => void submit()}
        fullWidth
      />
    </Sheet>
  );
}

// ── Gift sheet (bespoke private pass, no public plan) ───────────────
function GiftSheet({
  configs,
  busy,
  run,
  onClose,
}: {
  configs: PassConfigOption[];
  busy: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => Promise<boolean>;
  onClose: () => void;
}) {
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [configId, setConfigId] = useState(configs[0]?.id ?? "");
  const [hours, setHours] = useState("5");
  const [validity, setValidity] = useState("30");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [startDate, setStartDate] = useState(todayIso());

  async function submit() {
    if (!customer || !configId) return;
    const ok = await run(() =>
      adminPassesApi.gift({
        userId: customer.id,
        courtConfigId: configId,
        totalHours: Number(hours),
        validityDays: Number(validity),
        name: name.trim() || undefined,
        value: value.trim() !== "" ? Number(value) : undefined,
        note: note.trim() || undefined,
        startDate,
      }),
    );
    if (ok) onClose();
  }

  return (
    <Sheet title="Gift a custom pass" onClose={onClose}>
      <Text style={styles.emptyText}>
        Private pass on the recipient&apos;s account only — never listed on
        the storefront. Free by default; covers all hours.
      </Text>
      <Text style={styles.fieldLabel}>Customer</Text>
      <CustomerSearch picked={customer} onPick={setCustomer} />

      <Text style={styles.fieldLabel}>Court group</Text>
      <View style={styles.chipsWrap}>
        {configs.map((c) => (
          <Pressable
            key={c.id}
            onPress={() => setConfigId(c.id)}
            style={[styles.chip, configId === c.id && styles.chipOn]}
          >
            <Text style={[styles.chipText, configId === c.id && styles.chipTextOn]}>
              {c.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Input label="Hours" keyboardType="decimal-pad" value={hours} onChangeText={setHours} />
      <Input
        label="Validity (days)"
        keyboardType="number-pad"
        value={validity}
        onChangeText={setValidity}
      />
      <Input
        label="Name (optional — e.g. Birthday Gift Pass)"
        value={name}
        onChangeText={setName}
      />
      <Input
        label="Recorded value ₹ (optional, default 0)"
        keyboardType="number-pad"
        value={value}
        onChangeText={setValue}
      />
      <Input label="Note (optional)" value={note} onChangeText={setNote} />
      <Input
        label="Start date (YYYY-MM-DD, today → +90d)"
        autoCapitalize="none"
        value={startDate}
        onChangeText={setStartDate}
      />
      <Button
        label="Gift pass"
        loading={busy}
        disabled={!customer || !configId}
        onPress={() => void submit()}
        fullWidth
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing["4"],
    paddingBottom: spacing["8"],
  },
  tabsRow: {
    flexDirection: "row",
    gap: spacing["2"],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: "rgba(24,24,27,0.6)",
    padding: 4,
    marginBottom: spacing["4"],
  },
  tabBtn: {
    flex: 1,
    alignItems: "center",
    borderRadius: 8,
    paddingVertical: 8,
  },
  tabBtnOn: {
    backgroundColor: "rgba(16,185,129,0.15)",
  },
  tabText: {
    fontSize: 12,
    fontWeight: "500",
    color: colors.zinc400,
  },
  tabTextOn: {
    color: "#6ee7b7",
  },
  stack: {
    gap: spacing["3"],
  },
  rowButtons: {
    flexDirection: "row",
    gap: spacing["2"],
  },
  switchCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["4"],
  },
  switchTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  switchSub: {
    marginTop: 2,
    fontSize: 11,
    color: colors.zinc500,
    lineHeight: 15,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["4"],
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing["2"],
  },
  cardTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  cardMeta: {
    marginTop: 3,
    fontSize: 12,
    color: colors.zinc400,
  },
  cardBands: {
    marginTop: 3,
    fontSize: 11,
    color: colors.zinc500,
  },
  warnText: {
    marginTop: spacing["2"],
    fontSize: 11,
    color: "#fbbf24",
  },
  statusText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  anchorRow: {
    flexDirection: "row",
    gap: spacing["2"],
    marginTop: spacing["2"],
  },
  anchorChip: {
    borderRadius: 999,
    paddingHorizontal: spacing["3"],
    paddingVertical: 5,
    backgroundColor: colors.zinc800,
  },
  anchorChipOn: {
    backgroundColor: "rgba(16,185,129,0.14)",
  },
  cardActions: {
    marginTop: spacing["3"],
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["2"],
  },
  emptyText: {
    fontSize: 12,
    color: colors.zinc500,
    lineHeight: 17,
  },
  stepperRow: {
    marginTop: spacing["3"],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
  },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.zinc700,
    alignItems: "center",
    justifyContent: "center",
  },
  stepValue: {
    minWidth: 100,
    textAlign: "center",
    fontSize: 13,
    fontWeight: "600",
    color: colors.foreground,
  },

  // Sheet chrome
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    maxHeight: "88%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: colors.zinc900,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing["4"],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.zinc800,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.foreground,
  },
  sheetBody: {
    padding: spacing["4"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.zinc400,
  },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["2"],
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc700,
    paddingHorizontal: spacing["3"],
    paddingVertical: 7,
  },
  chipOn: {
    borderColor: colors.emerald500,
    backgroundColor: "rgba(16,185,129,0.12)",
  },
  chipText: {
    fontSize: 12,
    color: colors.zinc400,
  },
  chipTextOn: {
    color: "#6ee7b7",
    fontWeight: "600",
  },

  // Band grid
  bandGrid: {
    gap: spacing["2"],
  },
  bandCell: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.zinc700,
    paddingHorizontal: spacing["3"],
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  bandCellOn: {
    borderColor: colors.emerald500,
    backgroundColor: "rgba(16,185,129,0.10)",
  },
  bandCellLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.foreground,
  },
  bandCellPrice: {
    fontSize: 12,
    color: colors.zinc400,
  },
  bandHint: {
    fontSize: 11,
    color: colors.zinc500,
    lineHeight: 15,
  },

  // Customer search
  pickedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.emerald500,
    backgroundColor: "rgba(16,185,129,0.08)",
    padding: spacing["3"],
  },
  pickedName: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.foreground,
  },
  pickedPhone: {
    marginTop: 1,
    fontSize: 11,
    color: colors.zinc500,
  },
  searchRow: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.zinc800,
    padding: spacing["3"],
    marginTop: spacing["2"],
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    paddingVertical: spacing["2"],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.zinc800,
  },
});
