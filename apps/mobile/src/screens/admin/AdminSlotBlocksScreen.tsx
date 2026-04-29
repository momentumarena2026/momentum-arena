import { useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Lock,
  Plus,
  Trash2,
  X,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminSlotsApi,
  type AdminSlotBlock,
} from "../../lib/admin-slots";
import { adminBookingsApi, type AdminCourt } from "../../lib/admin-bookings";
import { AdminApiError } from "../../lib/admin-api";
import {
  formatHourCompact,
  sportLabel,
} from "../../lib/format";
import { getTodayIST } from "../../lib/ist-date";
import type { AdminCalendarSport } from "../../lib/admin-calendar";

const SPORT_EMOJI: Record<string, string> = {
  CRICKET: "🏏",
  FOOTBALL: "⚽",
  PICKLEBALL: "🏓",
};

const HOURS: number[] = (() => {
  const arr: number[] = [];
  // Operating hours mirror lib/court-config.ts: 5..24 (5 AM through 12 AM).
  for (let h = 5; h < 25; h++) arr.push(h);
  return arr;
})();

/**
 * Mirrors the web /admin/slots create-modal flow on a mobile-friendly
 * scroll surface.
 *
 *   - Top bar: date stepper (prev / today / next).
 *   - List card: every block on the chosen date, with a per-row
 *     delete button.
 *   - Bottom card: inline "add block" form (scope + hour + reason).
 *     Scope can be "all", "sport-only", or a specific court config —
 *     same expressivity as the web modal.
 *
 * No sport-active or config-active toggles — those are rare admin
 * ops the floor staff don't need on mobile.
 */
export function AdminSlotBlocksScreen() {
  const qc = useQueryClient();
  const today = getTodayIST();
  const [date, setDate] = useState<string>(today);

  const blocks = useQuery({
    queryKey: ["admin-slot-blocks", date],
    queryFn: () => adminSlotsApi.list(date),
    refetchOnWindowFocus: false,
  });

  const courts = useQuery({
    queryKey: ["admin-courts"],
    queryFn: () => adminBookingsApi.courts(),
    refetchOnWindowFocus: false,
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminSlotsApi.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-slot-blocks", date] });
    },
    onError: (err) =>
      Alert.alert(
        "Couldn't remove block",
        err instanceof AdminApiError ? err.message : "Try again.",
      ),
  });

  const create = useMutation({
    mutationFn: (body: Parameters<typeof adminSlotsApi.create>[0]) =>
      adminSlotsApi.create(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-slot-blocks", date] });
      Alert.alert("Block added", "Slot block created.");
    },
    onError: (err) =>
      Alert.alert(
        "Couldn't add block",
        err instanceof AdminApiError ? err.message : "Try again.",
      ),
  });

  function shiftDay(offset: number) {
    // UTC arithmetic — local-time parse + toISOString roundtrip
    // shifts the YYYY-MM-DD by the local TZ offset (IST = +5:30),
    // which made the right arrow appear dead and the left arrow
    // skip a day. Anchoring at UTC midnight keeps the string stable.
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + offset);
    setDate(d.toISOString().split("T")[0]);
  }

  const refreshing =
    (blocks.isFetching && !blocks.isLoading) || blocks.isRefetching;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void blocks.refetch()}
            tintColor={colors.yellow400}
          />
        }
      >
        {/* Date stepper */}
        <View style={styles.dateBar}>
          <Pressable onPress={() => shiftDay(-1)} hitSlop={8} style={styles.dateBtn}>
            <ChevronLeft size={16} color={colors.zinc300} />
          </Pressable>
          <View style={styles.dateLabel}>
            <CalendarDays size={14} color={colors.yellow400} />
            <Text variant="bodyStrong">{prettyDate(date)}</Text>
          </View>
          <Pressable onPress={() => shiftDay(1)} hitSlop={8} style={styles.dateBtn}>
            <ChevronRight size={16} color={colors.zinc300} />
          </Pressable>
        </View>

        {/* Existing blocks list */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Lock size={14} color={colors.zinc500} />
            <Text variant="tiny" color={colors.zinc500} style={styles.cardTitle}>
              ACTIVE BLOCKS
            </Text>
            {blocks.data ? (
              <Text variant="tiny" color={colors.zinc500} style={{ marginLeft: "auto" }}>
                {blocks.data.blocks.length}
              </Text>
            ) : null}
          </View>

          {blocks.isLoading ? (
            <View style={{ gap: spacing["2"] }}>
              <Skeleton width="100%" height={48} rounded="md" />
              <Skeleton width="100%" height={48} rounded="md" />
            </View>
          ) : blocks.isError ? (
            <Pressable
              onPress={() => void blocks.refetch()}
              style={styles.errorBlock}
            >
              <Text variant="small" color={colors.destructive}>
                Couldn't load blocks. Tap to retry.
              </Text>
            </Pressable>
          ) : blocks.data!.blocks.length === 0 ? (
            <Text variant="small" color={colors.zinc500}>
              No blocks for this date.
            </Text>
          ) : (
            <View style={{ gap: spacing["2"] }}>
              {blocks.data!.blocks.map((b) => (
                <BlockRow
                  key={b.id}
                  block={b}
                  isRemoving={
                    remove.isPending && remove.variables === b.id
                  }
                  onRemove={() =>
                    Alert.alert(
                      "Remove block?",
                      blockSummary(b) + " will become available again.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Remove",
                          style: "destructive",
                          onPress: () => remove.mutate(b.id),
                        },
                      ],
                    )
                  }
                />
              ))}
            </View>
          )}
        </View>

        {/* New block form */}
        <CreateBlockCard
          date={date}
          courts={courts.data?.courts ?? []}
          isCreating={create.isPending}
          onSubmit={(body) => create.mutate(body)}
        />
      </ScrollView>
    </Screen>
  );
}

function BlockRow({
  block,
  isRemoving,
  onRemove,
}: {
  block: AdminSlotBlock;
  isRemoving: boolean;
  onRemove: () => void;
}) {
  return (
    <View style={styles.blockRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="small" weight="600">
          {blockSummary(block)}
        </Text>
        {block.reason ? (
          <Text variant="tiny" color={colors.zinc500} numberOfLines={2}>
            {block.reason}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={onRemove}
        disabled={isRemoving}
        hitSlop={8}
        style={({ pressed }) => [
          styles.removeBtn,
          isRemoving && { opacity: 0.5 },
          pressed && { opacity: 0.6 },
        ]}
      >
        <Trash2 size={14} color={colors.destructive} />
      </Pressable>
    </View>
  );
}

type Scope = "ALL" | "SPORT" | "COURT";

function CreateBlockCard({
  date,
  courts,
  isCreating,
  onSubmit,
}: {
  date: string;
  courts: AdminCourt[];
  isCreating: boolean;
  onSubmit: (body: Parameters<typeof adminSlotsApi.create>[0]) => void;
}) {
  const [scope, setScope] = useState<Scope>("ALL");
  const [sport, setSport] = useState<AdminCalendarSport | null>(null);
  const [courtId, setCourtId] = useState<string | null>(null);
  const [hour, setHour] = useState<number | null>(null); // null = full day
  const [reason, setReason] = useState("");

  const filteredCourts = useMemo(() => {
    if (!sport) return courts;
    return courts.filter((c) => c.sport === sport);
  }, [courts, sport]);

  function reset() {
    setScope("ALL");
    setSport(null);
    setCourtId(null);
    setHour(null);
    setReason("");
  }

  function submit() {
    if (scope === "SPORT" && !sport) {
      Alert.alert("Pick a sport", "Choose which sport to block.");
      return;
    }
    if (scope === "COURT" && !courtId) {
      Alert.alert("Pick a court", "Choose which court to block.");
      return;
    }

    const body: Parameters<typeof adminSlotsApi.create>[0] = {
      date,
      reason: reason.trim() || undefined,
    };
    if (scope === "SPORT" && sport) body.sport = sport;
    if (scope === "COURT" && courtId) body.courtConfigId = courtId;
    if (hour !== null) body.startHour = hour;

    onSubmit(body);
    // Optimistic reset — invalidation will refresh the list, and the
    // user usually adds one block at a time.
    reset();
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Plus size={14} color={colors.zinc500} />
        <Text variant="tiny" color={colors.zinc500} style={styles.cardTitle}>
          ADD BLOCK
        </Text>
      </View>

      {/* Scope */}
      <View style={{ gap: spacing["1.5"] }}>
        <Text variant="tiny" color={colors.zinc500}>
          Scope
        </Text>
        <View style={styles.segments}>
          {(["ALL", "SPORT", "COURT"] as const).map((s) => (
            <Pressable
              key={s}
              onPress={() => {
                setScope(s);
                if (s !== "SPORT" && s !== "COURT") setSport(null);
                if (s !== "COURT") setCourtId(null);
              }}
              style={[
                styles.segment,
                scope === s && styles.segmentActive,
              ]}
            >
              <Text
                variant="tiny"
                color={scope === s ? colors.yellow400 : colors.zinc300}
                weight="600"
              >
                {s === "ALL"
                  ? "All courts"
                  : s === "SPORT"
                    ? "Sport"
                    : "One court"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Sport pick (visible when scope is SPORT or COURT) */}
      {scope === "SPORT" || scope === "COURT" ? (
        <View style={{ gap: spacing["1.5"] }}>
          <Text variant="tiny" color={colors.zinc500}>
            Sport
          </Text>
          <View style={styles.chipRow}>
            {(["CRICKET", "FOOTBALL", "PICKLEBALL"] as const).map((s) => {
              const active = sport === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => {
                    setSport(s);
                    setCourtId(null);
                  }}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text
                    variant="tiny"
                    color={active ? colors.yellow400 : colors.zinc300}
                    weight="600"
                  >
                    {SPORT_EMOJI[s]} {sportLabel(s)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* Court pick (visible only when scope is COURT) */}
      {scope === "COURT" ? (
        <View style={{ gap: spacing["1.5"] }}>
          <Text variant="tiny" color={colors.zinc500}>
            Court
          </Text>
          {filteredCourts.length === 0 ? (
            <Text variant="tiny" color={colors.zinc600}>
              {sport ? "No courts for that sport." : "Pick a sport first."}
            </Text>
          ) : (
            <View style={styles.chipRow}>
              {filteredCourts.map((c) => {
                const active = courtId === c.id;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => setCourtId(c.id)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text
                      variant="tiny"
                      color={active ? colors.yellow400 : colors.zinc300}
                      weight="600"
                    >
                      {c.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      ) : null}

      {/* Hour pick */}
      <View style={{ gap: spacing["1.5"] }}>
        <Text variant="tiny" color={colors.zinc500}>
          Hour {hour === null ? "(full day)" : ""}
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          <Pressable
            onPress={() => setHour(null)}
            style={[styles.chip, hour === null && styles.chipActive]}
          >
            <Text
              variant="tiny"
              color={hour === null ? colors.yellow400 : colors.zinc300}
              weight="600"
            >
              Full day
            </Text>
          </Pressable>
          {HOURS.map((h) => {
            const active = hour === h;
            return (
              <Pressable
                key={h}
                onPress={() => setHour(h)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text
                  variant="tiny"
                  color={active ? colors.yellow400 : colors.zinc300}
                  weight="600"
                >
                  {formatHourCompact(h)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Reason */}
      <View style={{ gap: spacing["1.5"] }}>
        <Text variant="tiny" color={colors.zinc500}>
          Reason (optional)
        </Text>
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder="e.g. Maintenance, private event"
          placeholderTextColor={colors.zinc600}
          style={styles.input}
        />
      </View>

      {/* Submit */}
      <View style={styles.actions}>
        <Pressable
          onPress={reset}
          style={[styles.actionBtn, styles.actionNeutral]}
        >
          <X size={14} color={colors.zinc300} />
          <Text variant="small" color={colors.zinc300} weight="600">
            Reset
          </Text>
        </Pressable>
        <Pressable
          onPress={submit}
          disabled={isCreating}
          style={[
            styles.actionBtn,
            styles.actionPrimary,
            isCreating && { opacity: 0.5 },
          ]}
        >
          <Plus size={14} color={colors.yellow400} />
          <Text variant="small" color={colors.yellow400} weight="600">
            {isCreating ? "Adding…" : "Add block"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function blockSummary(b: AdminSlotBlock): string {
  const scope = b.courtConfig
    ? `${SPORT_EMOJI[b.courtConfig.sport] ?? "🎯"} ${b.courtConfig.label}`
    : b.sport
      ? `${SPORT_EMOJI[b.sport] ?? "🎯"} ${sportLabel(b.sport)} (all courts)`
      : "All courts";
  const time =
    b.startHour === null
      ? "full day"
      : `${formatHourCompact(b.startHour)} – ${formatHourCompact(b.startHour + 1)}`;
  return `${scope} · ${time}`;
}

function prettyDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  dateBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  dateBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.background,
  },
  dateLabel: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["2"],
  },
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["4"],
    gap: spacing["3"],
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
  },
  cardTitle: { letterSpacing: 1.5, fontWeight: "700" },
  blockRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    padding: spacing["3"],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.background,
  },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.30)",
    backgroundColor: "rgba(239, 68, 68, 0.10)",
  },
  segments: {
    flexDirection: "row",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc800,
    overflow: "hidden",
  },
  segment: {
    flex: 1,
    paddingVertical: spacing["2"],
    alignItems: "center",
    backgroundColor: colors.zinc900,
  },
  segmentActive: { backgroundColor: "rgba(250, 204, 21, 0.10)" },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["2"],
  },
  chip: {
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["1.5"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  chipActive: {
    borderColor: "rgba(250, 204, 21, 0.40)",
    backgroundColor: "rgba(250, 204, 21, 0.10)",
  },
  input: {
    borderWidth: 1,
    borderColor: colors.zinc700,
    borderRadius: 8,
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2.5"],
    color: colors.foreground,
    backgroundColor: colors.background,
    fontSize: 14,
  },
  actions: {
    flexDirection: "row",
    gap: spacing["2"],
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["1.5"],
    paddingVertical: spacing["3"],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  actionNeutral: {
    borderColor: colors.zinc800,
    backgroundColor: colors.background,
  },
  actionPrimary: {
    borderColor: "rgba(250, 204, 21, 0.30)",
    backgroundColor: "rgba(250, 204, 21, 0.10)",
  },
  errorBlock: {
    padding: spacing["3"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.30)",
    backgroundColor: "rgba(239, 68, 68, 0.10)",
  },
});
