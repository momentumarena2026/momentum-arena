import { useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, Trash2, X } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminDailyPushLinesApi,
  type DailyPushLibraryView,
  type DailyPushLineView,
} from "../../lib/admin-daily-push";
import { AdminApiError } from "../../lib/admin-api";

const QUERY_KEY = ["admin-daily-push-lines"] as const;

const TAGS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "weekend", "weekday", "monsoon", "winter", "summer", "pleasant",
  "holi", "janmashtami", "diwali", "ipl", "india-match", "needs-slots",
];

function showError(e: unknown) {
  Alert.alert(
    "Couldn't save",
    e instanceof AdminApiError || e instanceof Error ? e.message : "Please try again.",
  );
}

/**
 * The creative library on the phone.
 *
 * Read, write and delete lines — but NOT occasion dates. Those are a
 * once-a-year job needing a calendar, and a wrong festival date is the
 * one mistake here that fails silently. The undated-tag warning still
 * shows, so the gap is visible from the phone even though fixing it is
 * a web job.
 */
export function AdminDailyPushLinesScreen() {
  const qc = useQueryClient();
  const view = useQuery({ queryKey: QUERY_KEY, queryFn: () => adminDailyPushLinesApi.get() });
  const [editing, setEditing] = useState<DailyPushLineView | "new" | null>(null);

  const save = useMutation({
    mutationFn: adminDailyPushLinesApi.save,
    onSuccess: (fresh: DailyPushLibraryView) => {
      qc.setQueryData(QUERY_KEY, fresh);
      setEditing(null);
    },
    onError: showError,
  });

  const remove = useMutation({
    mutationFn: adminDailyPushLinesApi.remove,
    onSuccess: (fresh: DailyPushLibraryView) => qc.setQueryData(QUERY_KEY, fresh),
    onError: showError,
  });

  const d = view.data;
  const today = useMemo(() => new Set(d?.todaysOccasions ?? []), [d?.todaysOccasions]);

  /** Mirrors lineIsEligible — kept in step by the parity test. */
  const canRun = (l: DailyPushLineView) => {
    if (!l.enabled) return false;
    if (l.tags.includes("needs-slots") && !(d?.slotsAreFree ?? false)) return false;
    const occ = l.tags.filter((t) => t !== "needs-slots");
    return occ.length === 0 || occ.some((t) => today.has(t));
  };

  if (view.isLoading || !d) {
    return (
      <Screen>
        <View style={{ gap: spacing["3"] }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} style={{ height: 70, borderRadius: radius.lg }} />
          ))}
        </View>
      </Screen>
    );
  }

  const eligible = d.lines.filter(canRun).length;

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
        <Card style={styles.card}>
          <View style={styles.rowBetween}>
            <Text weight="semibold" style={{ fontSize: 14 }}>Today</Text>
            <Text style={styles.note}>
              {eligible} of {d.lines.length} can run
            </Text>
          </View>
          <View style={styles.tagWrap}>
            {d.todaysOccasions.map((t) => (
              <View key={t} style={[styles.tag, styles.tagOn]}>
                <Text style={{ fontSize: 10, color: colors.emerald400 }}>{t}</Text>
              </View>
            ))}
          </View>
          {!d.slotsAreFree && (
            <Text style={styles.note}>
              No free evening slots, so the needs-slots lines are out of play today.
            </Text>
          )}
          {d.refusal ? <Text style={styles.warn}>{d.refusal}</Text> : null}
        </Card>

        {d.undatedTags.length > 0 && (
          <View style={styles.banner}>
            <AlertTriangle size={14} color="#fcd34d" />
            <Text style={{ flex: 1, fontSize: 11, color: "#fcd34d" }}>
              No dates set for {d.undatedTags.join(", ")} — those lines never fire.
              Set the windows on the web admin; they move every year.
            </Text>
          </View>
        )}

        <View style={styles.rowBetween}>
          <Text weight="semibold" style={{ fontSize: 14 }}>Lines {d.lines.length}</Text>
          <Pressable onPress={() => setEditing("new")} style={styles.addBtn}>
            <Plus size={12} color={colors.emerald400} />
            <Text style={{ fontSize: 11, color: colors.emerald400 }}>New</Text>
          </Pressable>
        </View>

        {d.lines.map((l) => (
          <Pressable key={l.id} onPress={() => setEditing(l)}>
            <Card style={styles.lineCard}>
              <View style={styles.lineTop}>
                <View style={[styles.dot, canRun(l) && styles.dotOn]} />
                <View style={{ flex: 1 }}>
                  <Text
                    weight="semibold"
                    style={{ fontSize: 13, color: l.enabled ? colors.foreground : colors.zinc500 }}
                  >
                    {l.title}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.zinc400, marginTop: 2 }}>{l.body}</Text>
                </View>
                <Pressable
                  onPress={() =>
                    Alert.alert("Delete this line?", l.title, [
                      { text: "Cancel", style: "cancel" },
                      { text: "Delete", style: "destructive", onPress: () => remove.mutate(l.id) },
                    ])
                  }
                  hitSlop={8}
                >
                  <Trash2 size={14} color={colors.zinc600} />
                </Pressable>
              </View>
              <View style={styles.tagWrap}>
                {l.tags.map((t) => (
                  <View
                    key={t}
                    style={[
                      styles.tag,
                      t === "needs-slots" ? styles.tagClaim : today.has(t) ? styles.tagOn : null,
                    ]}
                  >
                    <Text
                      style={{
                        fontSize: 10,
                        color:
                          t === "needs-slots"
                            ? "#fcd34d"
                            : today.has(t)
                              ? colors.emerald400
                              : colors.zinc500,
                      }}
                    >
                      {t}
                    </Text>
                  </View>
                ))}
                <Text style={{ fontSize: 10, color: colors.zinc600 }}>
                  {l.useCount === 0 ? "never sent" : `sent ${l.useCount}×`}
                </Text>
              </View>
            </Card>
          </Pressable>
        ))}
      </ScrollView>

      {editing && (
        <LineSheet
          line={editing === "new" ? null : editing}
          busy={save.isPending}
          onClose={() => setEditing(null)}
          onSave={(input) => save.mutate(input)}
        />
      )}
    </Screen>
  );
}

function LineSheet({
  line,
  busy,
  onClose,
  onSave,
}: {
  line: DailyPushLineView | null;
  busy: boolean;
  onClose: () => void;
  onSave: (i: { id?: string; title: string; body: string; tags: string[]; enabled: boolean }) => void;
}) {
  const [title, setTitle] = useState(line?.title ?? "");
  const [body, setBody] = useState(line?.body ?? "");
  const [tags, setTags] = useState<string[]>(line?.tags ?? []);
  const [enabled, setEnabled] = useState(line?.enabled ?? true);

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBg}>
        <View style={styles.sheet}>
          <View style={styles.rowBetween}>
            <Text weight="semibold" style={{ fontSize: 14 }}>
              {line ? "Edit line" : "New line"}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={18} color={colors.zinc400} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ gap: spacing["3"], paddingVertical: spacing["3"] }}>
            <View>
              <Text style={styles.fieldLabel}>Title · a lock screen shows ~40 characters</Text>
              <Input value={title} onChangeText={setTitle} maxLength={60} />
            </View>
            <View>
              <Text style={styles.fieldLabel}>Body</Text>
              <Input value={body} onChangeText={setBody} maxLength={200} multiline />
            </View>
            <View>
              <Text style={styles.fieldLabel}>Tags · none means it can run any day</Text>
              <View style={styles.tagWrap}>
                {TAGS.map((t) => {
                  const on = tags.includes(t);
                  return (
                    <Pressable
                      key={t}
                      onPress={() =>
                        setTags((c) => (c.includes(t) ? c.filter((x) => x !== t) : [...c, t]))
                      }
                      style={[styles.pick, on && (t === "needs-slots" ? styles.pickClaim : styles.pickOn)]}
                    >
                      <Text
                        style={{
                          fontSize: 11,
                          color: on ? (t === "needs-slots" ? "#fcd34d" : colors.emerald400) : colors.zinc500,
                        }}
                      >
                        {t}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {tags.includes("needs-slots") && (
                <Text style={styles.warn}>
                  This line claims the evening has space, so it only goes out when
                  courts are genuinely free.
                </Text>
              )}
            </View>
            <View style={styles.rowBetween}>
              <Text style={{ fontSize: 13 }}>In rotation</Text>
              <Switch
                value={enabled}
                onValueChange={setEnabled}
                trackColor={{ false: colors.zinc700, true: colors.emerald500 }}
                thumbColor="#fff"
              />
            </View>
            <View style={styles.preview}>
              <Text style={{ fontSize: 10, color: colors.zinc600 }}>LOCK SCREEN</Text>
              <Text weight="semibold" style={{ fontSize: 13, marginTop: 2 }}>{title || "Title"}</Text>
              <Text style={{ fontSize: 11, color: colors.zinc400 }}>{body || "Body"}</Text>
            </View>
            <Button
              label="Save"
              loading={busy}
              disabled={busy}
              fullWidth
              onPress={() => onSave({ id: line?.id, title, body, tags, enabled })}
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing["5"], paddingBottom: spacing["10"], gap: spacing["3"] },
  card: { gap: spacing["2"] },
  lineCard: { gap: spacing["2"] },
  lineTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing["2"] },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  note: { fontSize: 11, color: colors.zinc400 },
  warn: { fontSize: 11, color: "#fcd34d", marginTop: 4 },
  fieldLabel: { fontSize: 11, color: colors.zinc400, marginBottom: 4 },
  tagWrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  tag: {
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: colors.zinc800,
  },
  tagOn: { backgroundColor: "rgba(16,185,129,0.15)" },
  tagClaim: { backgroundColor: "rgba(252,211,77,0.12)" },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 6, backgroundColor: colors.zinc700 },
  dotOn: { backgroundColor: colors.emerald400 },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: colors.zinc800,
    borderRadius: radius.md,
    paddingHorizontal: spacing["2"],
    paddingVertical: 4,
  },
  banner: {
    flexDirection: "row",
    gap: spacing["2"],
    borderWidth: 1,
    borderColor: "rgba(252,211,77,0.30)",
    backgroundColor: "rgba(252,211,77,0.08)",
    borderRadius: radius.md,
    padding: spacing["3"],
  },
  pick: {
    borderWidth: 1,
    borderColor: colors.zinc800,
    borderRadius: radius.md,
    paddingHorizontal: spacing["2"],
    paddingVertical: 4,
  },
  pickOn: { borderColor: colors.emerald500, backgroundColor: "rgba(16,185,129,0.10)" },
  pickClaim: { borderColor: "rgba(252,211,77,0.40)", backgroundColor: "rgba(252,211,77,0.08)" },
  preview: {
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: radius.sm,
    padding: spacing["3"],
  },
  sheetBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  sheet: {
    maxHeight: "90%",
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    padding: spacing["4"],
  },
});
