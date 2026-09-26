import { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, CalendarClock, Eye, Users } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminDailyPushApi,
  type DailyPushAdminView,
  type DailyPushRun,
  type DailyPushSettings,
} from "../../lib/admin-daily-push";
import { AdminApiError } from "../../lib/admin-api";

const QUERY_KEY = ["admin-daily-push"] as const;

const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

function showError(e: unknown) {
  Alert.alert(
    "Couldn't save",
    e instanceof AdminApiError || e instanceof Error ? e.message : "Please try again.",
  );
}

/**
 * The daily push — mirrors the web /admin/push/daily dashboard.
 *
 * The validator is NOT reimplemented here. Save posts to the same
 * server action the web calls, and an incoherent combination comes back
 * as a 400 with the same sentence — so the two surfaces cannot disagree
 * about what is savable. That costs a round trip the web avoids, and it
 * buys the thing that actually matters: one set of rules.
 */
export function AdminDailyPushScreen() {
  const qc = useQueryClient();
  const view = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => adminDailyPushApi.get(),
  });

  const [s, setS] = useState<DailyPushSettings | null>(null);
  const [run, setRun] = useState<DailyPushRun | null>(null);

  // Seed the form once the server answers, and re-seed whenever the
  // server's copy changes underneath us (a save, or a pull-to-refresh).
  useEffect(() => {
    if (view.data) setS(view.data.settings);
  }, [view.data]);

  const save = useMutation({
    mutationFn: (next: DailyPushSettings) => adminDailyPushApi.save(next),
    onSuccess: (fresh: DailyPushAdminView) => {
      qc.setQueryData(QUERY_KEY, fresh);
      Alert.alert("Saved", "The daily push settings are live.");
    },
    onError: showError,
  });

  const dry = useMutation({
    mutationFn: () => adminDailyPushApi.dryRun(),
    onSuccess: setRun,
    onError: showError,
  });

  if (view.isLoading || !s) {
    return (
      <Screen>
        <View style={{ gap: spacing["3"] }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} style={{ height: 90, borderRadius: radius.lg }} />
          ))}
        </View>
      </Screen>
    );
  }

  if (view.isError) {
    return (
      <Screen>
        <Text style={{ color: colors.zinc400 }}>
          Couldn&apos;t load the daily push settings. Pull down to retry.
        </Text>
      </Screen>
    );
  }

  const d = view.data!;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={view.isRefetching}
            onRefresh={() => void view.refetch()}
            tintColor={colors.zinc400}
          />
        }
      >
        <Text style={styles.intro}>
          The one message the arena sends that nobody asked for. Each person gets
          the first rule that is true for them — and nothing at all if none is.
        </Text>

        {/* Reach */}
        <View style={styles.statRow}>
          <Stat icon={<Users size={14} color={colors.emerald400} />} label="Reachable" value={String(d.reachable)} />
          <Stat icon={<BellOff size={14} color="#fcd34d" />} label="Opted out" value={String(d.optedOut)} />
          <Stat
            icon={<CalendarClock size={14} color="#93c5fd" />}
            label="Last sent"
            value={d.lastSentAt ? new Date(d.lastSentAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "Never"}
          />
        </View>

        {/* The switch */}
        <Card style={styles.card}>
          <Row
            label="Send the daily push"
            hint={s.enabled ? `Every day at ${hourLabel(s.sendHourIST)} IST.` : "Off. Nothing is sent."}
            value={s.enabled}
            onChange={(v) => setS({ ...s, enabled: v })}
          />
          <HourField label="Send at (IST)" value={s.sendHourIST} onChange={(v) => setS({ ...s, sendHourIST: v })} />
          <HourField label="Quiet from" value={s.quietFromHour} onChange={(v) => setS({ ...s, quietFromHour: v })} />
          <HourField label="Quiet until" value={s.quietToHour} onChange={(v) => setS({ ...s, quietToHour: v })} />
          <Text style={styles.note}>
            Quiet hours win over the send time. A run that wakes inside the window
            sends nothing and does not queue for morning.
          </Text>
        </Card>

        {/* Guards */}
        <Card style={styles.card}>
          <Text weight="semibold" style={styles.cardTitle}>Who gets left alone</Text>
          <NumField
            label="Most per person, per week"
            value={s.maxPerUserPerWeek}
            onChange={(v) => setS({ ...s, maxPerUserPerWeek: v })}
          />
          <Row
            label="Skip anyone playing today or tomorrow"
            hint="They already booked; their reminder goes out separately."
            value={s.skipIfBookedSoon}
            onChange={(v) => setS({ ...s, skipIfBookedSoon: v })}
          />
          <Row
            label="Skip anyone who already heard from us today"
            hint="Targeted pushes only — a broadcast has no single recipient, so it is invisible to this."
            value={s.skipIfPushedToday}
            onChange={(v) => setS({ ...s, skipIfPushedToday: v })}
          />
          <Text style={styles.note}>
            {d.optedOut} {d.optedOut === 1 ? "person has" : "people have"} switched it off in the app, and
            they are skipped regardless of everything above.
          </Text>
        </Card>

        {/* Rules */}
        <Card style={styles.card}>
          <Text weight="semibold" style={styles.cardTitle}>The rules, in order</Text>
          <Text style={styles.note}>
            First one true for a person wins. Someone lapsed AND holding an
            expiring pass hears about the pass — the money is more urgent.
          </Text>

          <Rule
            n={1}
            title="Pass about to expire"
            sent={d.lastWeekByRule.find((r) => r.rule === "PASS_EXPIRY")?.count ?? 0}
            value={s.passExpiry.enabled}
            onChange={(v) => setS({ ...s, passExpiry: { ...s.passExpiry, enabled: v } })}
          >
            <NumField
              label="Warn this many days before"
              value={s.passExpiry.days}
              onChange={(v) => setS({ ...s, passExpiry: { ...s.passExpiry, days: v } })}
            />
          </Rule>

          <Rule
            n={2}
            title="Installed but never booked"
            sent={d.lastWeekByRule.find((r) => r.rule === "NEVER_BOOKED")?.count ?? 0}
            value={s.neverBooked.enabled}
            onChange={(v) => setS({ ...s, neverBooked: { ...s.neverBooked, enabled: v } })}
          >
            <NumField
              label="Only after this many days"
              value={s.neverBooked.days}
              onChange={(v) => setS({ ...s, neverBooked: { ...s.neverBooked, days: v } })}
            />
          </Rule>

          <Rule
            n={3}
            title="Booked before, gone quiet"
            sent={d.lastWeekByRule.find((r) => r.rule === "LAPSED")?.count ?? 0}
            value={s.lapsed.enabled}
            onChange={(v) => setS({ ...s, lapsed: { ...s.lapsed, enabled: v } })}
          >
            <NumField
              label="Quiet for this many days"
              value={s.lapsed.days}
              onChange={(v) => setS({ ...s, lapsed: { ...s.lapsed, days: v } })}
            />
          </Rule>

          <Rule
            n={4}
            title="Free slots tonight"
            sent={d.lastWeekByRule.find((r) => r.rule === "FREE_SLOTS")?.count ?? 0}
            value={s.freeSlots.enabled}
            onChange={(v) => setS({ ...s, freeSlots: { ...s.freeSlots, enabled: v } })}
          >
            <HourField
              label="Tonight starts at"
              value={s.freeSlots.fromHour}
              onChange={(v) => setS({ ...s, freeSlots: { ...s.freeSlots, fromHour: v } })}
            />
            <NumField
              label="Only if at least this many are free"
              value={s.freeSlots.minOpen}
              onChange={(v) => setS({ ...s, freeSlots: { ...s.freeSlots, minOpen: v } })}
            />
          </Rule>
        </Card>

        <View style={{ gap: spacing["2"] }}>
          <Button
            label="Save"
            loading={save.isPending}
            onPress={() => save.mutate(s)}
            disabled={save.isPending}
            fullWidth
          />
          <Button
            label="Dry run"
            variant="secondary"
            loading={dry.isPending}
            onPress={() => dry.mutate()}
            disabled={dry.isPending}
            fullWidth
          />
          <Text style={styles.note}>
            A dry run sends nothing. It evaluates every rule against the real
            audience and shows you the result.
          </Text>
        </View>

        {run && <DryRun run={run} />}
      </ScrollView>
    </Screen>
  );
}

function DryRun({ run }: { run: DailyPushRun }) {
  const reasons = Object.entries(run.skipped).sort((a, b) => b[1] - a[1]);
  return (
    <Card style={{ ...styles.card, ...styles.dryCard }}>
      <View style={styles.dryHead}>
        <Eye size={14} color="#93c5fd" />
        <Text weight="semibold" style={{ fontSize: 13 }}>What tonight&apos;s run would do</Text>
      </View>
      <Text style={styles.note}>
        Evaluated against {run.considered} reachable{" "}
        {run.considered === 1 ? "customer" : "customers"}. Nothing was sent.
      </Text>

      {run.refusal ? (
        <Text style={styles.refusal}>{run.refusal}</Text>
      ) : (
        <>
          <Text style={styles.note}>
            Tonight the arena has {run.venue.freeSlotsTonight} free{" "}
            {run.venue.freeSlotsTonight === 1 ? "slot" : "slots"}
            {run.venue.sports.length > 0
              ? ` across ${run.venue.sports.map((x) => x.toLowerCase()).join(", ")}`
              : ""}
            .
          </Text>

          {run.buckets.length === 0 ? (
            <Text style={styles.note}>Nobody would be sent to.</Text>
          ) : (
            run.buckets.map((b) => (
              <View key={b.rule} style={styles.bucket}>
                <View style={styles.bucketHead}>
                  <Text weight="semibold" style={{ fontSize: 12, color: colors.emerald400 }}>
                    {b.label}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.zinc400 }}>
                    {b.count} {b.count === 1 ? "person" : "people"}
                  </Text>
                </View>
                {b.title ? (
                  <View style={styles.preview}>
                    <Text weight="semibold" style={{ fontSize: 13 }}>{b.title}</Text>
                    <Text style={{ fontSize: 11, color: colors.zinc400, marginTop: 2 }}>{b.body}</Text>
                  </View>
                ) : null}
                {b.sample.length > 0 ? (
                  <Text style={styles.sample}>
                    e.g. {b.sample.join(", ")}
                    {b.count > b.sample.length ? ` +${b.count - b.sample.length} more` : ""}
                  </Text>
                ) : null}
              </View>
            ))
          )}

          {reasons.length > 0 && (
            <View style={styles.bucket}>
              <Text weight="semibold" style={{ fontSize: 12, color: colors.zinc400 }}>
                Everyone else, and why
              </Text>
              {reasons.map(([reason, n]) => (
                <View key={reason} style={styles.reasonRow}>
                  <Text style={{ fontSize: 11, color: colors.zinc400, flex: 1 }}>{reason}</Text>
                  <Text style={{ fontSize: 11, color: colors.zinc400 }}>{n}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </Card>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <View style={styles.statHead}>
        <Text style={{ fontSize: 10, color: colors.zinc400 }}>{label}</Text>
        {icon}
      </View>
      <Text weight="bold" style={{ fontSize: 16 }}>{value}</Text>
    </View>
  );
}

function Row({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, paddingRight: spacing["3"] }}>
        <Text style={{ fontSize: 13 }}>{label}</Text>
        <Text style={styles.note}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.zinc700, true: colors.emerald500 }}
        thumbColor="#fff"
      />
    </View>
  );
}

function Rule({
  n,
  title,
  sent,
  value,
  onChange,
  children,
}: {
  n: number;
  title: string;
  sent: number;
  value: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.rule}>
      <View style={styles.row}>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: spacing["2"] }}>
          <View style={[styles.badge, value && styles.badgeOn]}>
            <Text weight="bold" style={{ fontSize: 10, color: value ? colors.emerald400 : colors.zinc400 }}>
              {n}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13 }}>{title}</Text>
            <Text style={styles.note}>{sent} sent (7d)</Text>
          </View>
        </View>
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ false: colors.zinc700, true: colors.emerald500 }}
          thumbColor="#fff"
        />
      </View>
      {value ? <View style={{ gap: spacing["2"] }}>{children}</View> : null}
    </View>
  );
}

/** A plain number box. Empty input holds the previous value rather than
 *  collapsing to 0, which would silently mute a rule. */
function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Input
        keyboardType="number-pad"
        value={String(value)}
        onChangeText={(t) => {
          const n = parseInt(t, 10);
          if (!isNaN(n)) onChange(n);
        }}
      />
    </View>
  );
}

/** Hours as tappable chips — a 24-option picker is worse on a phone than
 *  a horizontal strip the venue can thumb through. */
function HourField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {Array.from({ length: 24 }, (_, h) => h).map((h) => {
          const on = h === value;
          return (
            <Pressable
              key={h}
              onPress={() => onChange(h)}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={{ fontSize: 11, color: on ? colors.emerald400 : colors.zinc400 }}>
                {hourLabel(h)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing["5"], paddingBottom: spacing["10"], gap: spacing["4"] },
  intro: { fontSize: 12, color: colors.zinc400 },
  statRow: { flexDirection: "row", gap: spacing["2"] },
  stat: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    borderRadius: radius.lg,
    padding: spacing["3"],
    gap: 4,
  },
  statHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  card: { gap: spacing["3"] },
  cardTitle: { fontSize: 14 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  note: { fontSize: 11, color: colors.zinc400 },
  fieldLabel: { fontSize: 11, color: colors.zinc400, marginBottom: 4 },
  rule: {
    borderTopWidth: 1,
    borderTopColor: colors.zinc800,
    paddingTop: spacing["3"],
    gap: spacing["2"],
  },
  badge: {
    width: 20,
    height: 20,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.zinc800,
  },
  badgeOn: { backgroundColor: "rgba(16,185,129,0.15)" },
  chips: { gap: spacing["2"], paddingVertical: 2 },
  chip: {
    borderWidth: 1,
    borderColor: colors.zinc800,
    borderRadius: radius.md,
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
  },
  chipOn: { borderColor: colors.emerald500, backgroundColor: "rgba(16,185,129,0.10)" },
  dryCard: { borderColor: "rgba(59,130,246,0.30)" },
  dryHead: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  refusal: { fontSize: 12, color: "#fcd34d" },
  bucket: {
    borderWidth: 1,
    borderColor: colors.zinc800,
    borderRadius: radius.md,
    padding: spacing["3"],
    gap: 4,
  },
  bucketHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  preview: { backgroundColor: "rgba(0,0,0,0.35)", borderRadius: radius.sm, padding: spacing["2"] },
  sample: { fontSize: 10, color: colors.zinc500 },
  reasonRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing["3"] },
});
