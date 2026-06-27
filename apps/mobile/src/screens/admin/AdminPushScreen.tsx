import { useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  Send,
  Smartphone,
  Apple,
  Globe,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminPushApi,
  type PushScreen,
  type RecentPushSend,
} from "../../lib/admin-push";
import { AdminApiError } from "../../lib/admin-api";

const TITLE_MAX = 100;
const BODY_MAX = 500;

// "On tap, open" options — mirrors the web broadcast form's dropdown.
// `null` = just open the app to its current screen.
const DESTINATIONS: { value: PushScreen | null; label: string }[] = [
  { value: null, label: "Just open app" },
  { value: "home", label: "Home" },
  { value: "book", label: "Book a slot" },
  { value: "cafe", label: "Cafe" },
  { value: "shop", label: "Shop" },
  { value: "rewards", label: "Rewards" },
];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function audienceLabel(r: RecentPushSend): string {
  if (r.source === "test") return "test";
  return r.audience ?? "all";
}

export function AdminPushScreen() {
  const qc = useQueryClient();
  const overview = useQuery({
    queryKey: ["admin", "push", "overview"],
    queryFn: () => adminPushApi.overview(),
  });

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [destination, setDestination] = useState<PushScreen | null>(null);
  const [feedback, setFeedback] = useState<
    | { kind: "success"; message: string }
    | { kind: "error"; message: string }
    | null
  >(null);

  const reach = overview.data?.reach;
  const recent = overview.data?.recent ?? [];

  const send = useMutation({
    mutationFn: () =>
      adminPushApi.send({
        title: title.trim(),
        body: body.trim(),
        screen: destination ?? undefined,
      }),
    onSuccess: (r) => {
      setFeedback({
        kind: "success",
        message: `Sent. ${r.succeeded}/${r.attempted} delivered${
          r.cleanedUp > 0
            ? `, ${r.cleanedUp} dead token${r.cleanedUp === 1 ? "" : "s"} pruned`
            : ""
        }.`,
      });
      setTitle("");
      setBody("");
      void qc.invalidateQueries({ queryKey: ["admin", "push", "overview"] });
    },
    onError: (e) =>
      setFeedback({
        kind: "error",
        message:
          e instanceof AdminApiError || e instanceof Error
            ? e.message
            : "Failed to send",
      }),
  });

  const canSend =
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    !!reach &&
    reach.all > 0 &&
    !send.isPending;

  // Confirm before firing — this hits the lock screen of every device.
  function confirmAndSend() {
    setFeedback(null);
    const count = reach?.all ?? 0;
    const destLabel =
      DESTINATIONS.find((d) => d.value === destination)?.label ?? "Just open app";
    Alert.alert(
      "Send to all devices?",
      `This will push "${title.trim()}" to ${count} device${
        count === 1 ? "" : "s"
      }.\n\nOn tap: ${destLabel}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send",
          style: "destructive",
          onPress: () => send.mutate(),
        },
      ],
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={overview.isRefetching && !overview.isLoading}
            onRefresh={() => void overview.refetch()}
            tintColor={colors.zinc400}
          />
        }
      >
        {/* Reach summary */}
        {overview.isLoading ? (
          <View style={styles.reachRow}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.reachCard}>
                <Skeleton width={40} height={22} />
                <Skeleton width={60} height={10} />
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.reachRow}>
            <ReachStat
              icon={<Globe size={14} color={colors.emerald400} />}
              value={reach?.all ?? 0}
              label="All devices"
            />
            <ReachStat
              icon={<Smartphone size={14} color={colors.zinc400} />}
              value={reach?.android ?? 0}
              label="Android"
            />
            <ReachStat
              icon={<Apple size={14} color={colors.zinc400} />}
              value={reach?.ios ?? 0}
              label="iOS"
            />
          </View>
        )}

        {/* Compose form */}
        <Card style={styles.formCard}>
          <View style={styles.formHead}>
            <Bell size={16} color={colors.emerald400} />
            <Text variant="bodyStrong" color={colors.foreground}>
              Send broadcast
            </Text>
          </View>
          <Text variant="tiny" color={colors.zinc500}>
            Lands on the lock screen of every registered device.
          </Text>

          <Input
            label="Title"
            placeholder="e.g. Turf closed today due to rain"
            value={title}
            onChangeText={(t) => {
              setTitle(t);
              setFeedback(null);
            }}
            maxLength={TITLE_MAX}
            hint={`${title.length}/${TITLE_MAX}`}
          />

          <Input
            label="Body"
            placeholder="Plain text — emoji are fine."
            value={body}
            onChangeText={(t) => {
              setBody(t);
              setFeedback(null);
            }}
            maxLength={BODY_MAX}
            multiline
            style={styles.bodyInput}
            hint={`${body.length}/${BODY_MAX}`}
          />

          <Text variant="tiny" color={colors.zinc500} style={styles.destLabel}>
            ON TAP, OPEN
          </Text>
          <View style={styles.destRow}>
            {DESTINATIONS.map((d) => {
              const on = destination === d.value;
              return (
                <Pressable
                  key={d.label}
                  onPress={() => {
                    setDestination(d.value);
                    setFeedback(null);
                  }}
                  style={[styles.destChip, on && styles.destChipActive]}
                >
                  <Text
                    variant="tiny"
                    weight="600"
                    color={on ? colors.emerald400 : colors.zinc400}
                  >
                    {d.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {feedback ? (
            <View
              style={[
                styles.feedback,
                feedback.kind === "success"
                  ? styles.feedbackSuccess
                  : styles.feedbackError,
              ]}
            >
              {feedback.kind === "success" ? (
                <CheckCircle2 size={14} color={colors.emerald400} />
              ) : (
                <AlertTriangle size={14} color={colors.destructive} />
              )}
              <Text
                variant="small"
                color={
                  feedback.kind === "success"
                    ? colors.emerald400
                    : colors.destructive
                }
                style={{ flex: 1 }}
              >
                {feedback.message}
              </Text>
            </View>
          ) : null}

          <Button
            label={
              reach
                ? `Send to ${reach.all} device${reach.all === 1 ? "" : "s"}`
                : "Send broadcast"
            }
            onPress={confirmAndSend}
            disabled={!canSend}
            loading={send.isPending}
            fullWidth
            size="lg"
            leadingIcon={
              send.isPending ? undefined : (
                <Send size={16} color={colors.primaryForeground} />
              )
            }
          />
        </Card>

        {/* Recent sends */}
        <View>
          <Text
            variant="tiny"
            color={colors.zinc500}
            style={styles.recentLabel}
          >
            RECENT SENDS
          </Text>
          {overview.isLoading ? (
            <View style={styles.list}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={styles.skeleton}>
                  <Skeleton width={140} height={16} />
                  <Skeleton width="70%" height={11} />
                </View>
              ))}
            </View>
          ) : recent.length === 0 ? (
            <Card style={styles.emptyCard}>
              <Bell size={28} color={colors.zinc600} />
              <Text
                variant="small"
                color={colors.zinc500}
                style={{ marginTop: spacing["2"] }}
              >
                No broadcasts sent yet.
              </Text>
            </Card>
          ) : (
            <View style={styles.list}>
              {recent.map((r) => (
                <Card key={r.id} style={styles.recentCard}>
                  <View style={styles.recentHead}>
                    <Text
                      variant="bodyStrong"
                      color={colors.foreground}
                      numberOfLines={1}
                      style={{ flex: 1 }}
                    >
                      {r.title}
                    </Text>
                    <Text variant="tiny" color={colors.zinc500}>
                      {timeAgo(r.createdAt)}
                    </Text>
                  </View>
                  <Text
                    variant="small"
                    color={colors.zinc400}
                    numberOfLines={2}
                    style={{ marginTop: 2 }}
                  >
                    {r.body}
                  </Text>
                  <View style={styles.recentMeta}>
                    <View style={styles.metaPill}>
                      <Text variant="tiny" weight="600" color={colors.zinc400}>
                        {audienceLabel(r)}
                      </Text>
                    </View>
                    <Text variant="tiny" color={colors.zinc500}>
                      {r.succeeded}/{r.attempted} delivered
                      {r.failed > 0 ? ` · ${r.failed} failed` : ""}
                    </Text>
                  </View>
                </Card>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

function ReachStat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <View style={styles.reachCard}>
      <View style={styles.reachTop}>
        {icon}
        <Text variant="title" weight="700" color={colors.foreground}>
          {value}
        </Text>
      </View>
      <Text variant="tiny" color={colors.zinc500}>
        {label}
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
  reachRow: { flexDirection: "row", gap: spacing["3"] },
  reachCard: {
    flex: 1,
    padding: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    gap: spacing["1"],
  },
  reachTop: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  formCard: { padding: spacing["4"], gap: spacing["3"] },
  formHead: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  bodyInput: { minHeight: 84, textAlignVertical: "top", paddingTop: spacing["2"] },
  destLabel: { letterSpacing: 1.2, fontWeight: "700", marginTop: spacing["1"] },
  destRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing["2"] },
  destChip: {
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  destChipActive: {
    borderColor: colors.emerald400,
    backgroundColor: colors.emerald500_10,
  },
  feedback: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  feedbackSuccess: {
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_10,
  },
  feedbackError: {
    borderColor: colors.destructive_30,
    backgroundColor: colors.destructive_10,
  },
  recentLabel: {
    letterSpacing: 1.2,
    fontWeight: "700",
    marginBottom: spacing["2"],
  },
  list: { gap: spacing["3"] },
  recentCard: { padding: spacing["4"] },
  recentHead: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  recentMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    marginTop: spacing["2"],
  },
  metaPill: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.zinc800,
  },
  skeleton: {
    padding: spacing["4"],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    gap: spacing["2"],
  },
  emptyCard: { alignItems: "center", paddingVertical: spacing["10"] },
});
