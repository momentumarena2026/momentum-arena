import { useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BellRing,
  CheckCircle2,
  ChevronRight,
  AlertTriangle,
  Send,
  Smartphone,
  Apple,
  Globe,
  Users,
  Search,
  X,
  Eye,
  Trash2,
  Loader2,
  SmartphoneCharging,
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
  type PushAudience,
  type PushUserMatch,
  type PushGroupOption,
  type PushDevice,
  type RecentPushSend,
} from "../../lib/admin-push";
import { AdminApiError } from "../../lib/admin-api";
import type { AdminMoreStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<AdminMoreStackParamList, "AdminPush">;

const TITLE_MAX = 100;
const BODY_MAX = 500;

type AudienceKind = "all" | "android" | "ios" | "group" | "user";

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

const AUDIENCES: { value: AudienceKind; label: string; icon: typeof Globe }[] = [
  { value: "all", label: "All devices", icon: Globe },
  { value: "android", label: "Android", icon: Smartphone },
  { value: "ios", label: "iOS", icon: Apple },
  { value: "group", label: "User group", icon: Users },
  { value: "user", label: "Specific user", icon: Search },
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
  const navigation = useNavigation<Nav>();
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

  // Audience state
  const [audKind, setAudKind] = useState<AudienceKind>("all");
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [userQuery, setUserQuery] = useState("");
  const [userMatches, setUserMatches] = useState<PushUserMatch[]>([]);
  const [selectedUser, setSelectedUser] = useState<PushUserMatch | null>(null);
  const [searching, setSearching] = useState(false);

  const [devicesOpen, setDevicesOpen] = useState(false);

  const reach = overview.data?.reach;
  const groups = overview.data?.groups ?? [];
  const recent = overview.data?.recent ?? [];
  const staleDevices = overview.data?.staleDevices ?? 0;

  function clearFeedback() {
    setFeedback(null);
  }

  // Map the UI kind onto the server's discriminated union, failing loudly
  // if the admin hits Send/Preview without picking a group / user.
  function buildAudience(): PushAudience | { error: string } {
    if (audKind === "all") return { kind: "all" };
    if (audKind === "android") return { kind: "platform", platform: "android" };
    if (audKind === "ios") return { kind: "platform", platform: "ios" };
    if (audKind === "group") {
      if (!selectedGroupId) return { error: "Pick a user group first" };
      return { kind: "group", groupId: selectedGroupId };
    }
    if (!selectedUser) return { error: "Pick a user first" };
    return { kind: "user", userId: selectedUser.id };
  }

  // Best-effort local reach estimate for the picker (the dry-run is the
  // source of truth for groups/users; this just keeps the CTA informative).
  function estimatedReach(): number | null {
    if (!reach) return null;
    if (audKind === "all") return reach.all;
    if (audKind === "android") return reach.android;
    if (audKind === "ios") return reach.ios;
    if (audKind === "group") {
      return groups.find((g) => g.id === selectedGroupId)?.deviceCount ?? null;
    }
    return selectedUser?.deviceCount ?? null;
  }

  async function runUserSearch(q: string) {
    setUserQuery(q);
    setFeedback(null);
    if (q.trim().length < 2) {
      setUserMatches([]);
      return;
    }
    setSearching(true);
    try {
      const rows = await adminPushApi.searchUsers(q.trim());
      setUserMatches(rows);
    } catch {
      setUserMatches([]);
    } finally {
      setSearching(false);
    }
  }

  // ── Send / preview ────────────────────────────────────────────────
  const send = useMutation({
    mutationFn: (dryRun: boolean) => {
      const audience = buildAudience();
      if ("error" in audience) {
        return Promise.reject(new Error(audience.error));
      }
      return adminPushApi.send({
        audience,
        title: title.trim(),
        body: body.trim(),
        screen: destination ?? undefined,
        dryRun,
      });
    },
    onSuccess: (r) => {
      if (r.dryRun) {
        setFeedback({
          kind: "success",
          message: `Reach preview: would send to ${r.attempted} device${
            r.attempted === 1 ? "" : "s"
          }.`,
        });
        return;
      }
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

  // ── Test push to MY device only (clearly distinct from a broadcast) ──
  const testPush = useMutation({
    mutationFn: () =>
      adminPushApi.testToSelf({
        // Preview the composed copy when present, else the default test text.
        title: title.trim() || undefined,
        body: body.trim() || undefined,
      }),
    onSuccess: (r) => {
      setFeedback({
        kind: r.succeeded > 0 ? "success" : "error",
        message:
          r.succeeded > 0
            ? `Test push sent to your device${
                r.attempted === 1 ? "" : "s"
              } (${r.succeeded}/${r.attempted}). Check your lock screen.`
            : `Test push reached 0 of ${r.attempted} of your devices.`,
      });
      void qc.invalidateQueries({ queryKey: ["admin", "push", "overview"] });
    },
    onError: (e) =>
      setFeedback({
        kind: "error",
        message:
          e instanceof AdminApiError || e instanceof Error
            ? e.message
            : "Failed to send test",
      }),
  });

  const busy = send.isPending || testPush.isPending;
  const hasContent = title.trim().length > 0 && body.trim().length > 0;
  const audienceReady =
    audKind === "all" ||
    audKind === "android" ||
    audKind === "ios" ||
    (audKind === "group" && !!selectedGroupId) ||
    (audKind === "user" && !!selectedUser);
  const canSend = hasContent && audienceReady && !busy;
  const estReach = estimatedReach();

  const audienceDescription = (): string => {
    if (audKind === "all") return "all registered devices";
    if (audKind === "android") return "all Android devices";
    if (audKind === "ios") return "all iOS devices";
    if (audKind === "group") {
      const g = groups.find((x) => x.id === selectedGroupId);
      return g ? `the "${g.name}" group` : "the selected group";
    }
    return selectedUser?.name || selectedUser?.phone || "the selected user";
  };

  // Confirm before firing a real broadcast — this hits real customer phones.
  function confirmAndSend() {
    setFeedback(null);
    const audience = buildAudience();
    if ("error" in audience) {
      setFeedback({ kind: "error", message: audience.error });
      return;
    }
    const destLabel =
      DESTINATIONS.find((d) => d.value === destination)?.label ?? "Just open app";
    const reachText =
      estReach !== null
        ? `${estReach} device${estReach === 1 ? "" : "s"}`
        : "all matching devices";
    Alert.alert(
      "Send broadcast?",
      `This will push "${title.trim()}" to ${reachText} (${audienceDescription()}).\n\nOn tap: ${destLabel}\n\nThis goes to real customers and cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send broadcast",
          style: "destructive",
          onPress: () => send.mutate(false),
        },
      ],
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
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

        {/* Automated (event-triggered) templates entry */}
        <Pressable
          style={styles.manageRow}
          onPress={() => navigation.navigate("AdminPushTemplates")}
        >
          <View style={styles.manageLeft}>
            <BellRing size={16} color={colors.zinc400} />
            <Text variant="small" color={colors.foreground} weight="500">
              Automated messages
            </Text>
          </View>
          <ChevronRight size={16} color={colors.zinc500} />
        </Pressable>

        {/* Manage devices entry */}
        <Pressable
          style={styles.manageRow}
          onPress={() => setDevicesOpen(true)}
        >
          <View style={styles.manageLeft}>
            <SmartphoneCharging size={16} color={colors.zinc400} />
            <Text variant="small" color={colors.foreground} weight="500">
              Manage registered devices
            </Text>
          </View>
          {staleDevices > 0 ? (
            <View style={styles.stalePill}>
              <Text variant="tiny" weight="700" color={colors.warning}>
                {staleDevices} stale
              </Text>
            </View>
          ) : (
            <Text variant="tiny" color={colors.zinc500}>
              View
            </Text>
          )}
        </Pressable>

        {/* Compose form */}
        <Card style={styles.formCard}>
          <View style={styles.formHead}>
            <Bell size={16} color={colors.emerald400} />
            <Text variant="bodyStrong" color={colors.foreground}>
              Send broadcast
            </Text>
          </View>
          <Text variant="tiny" color={colors.zinc500}>
            Lands on the lock screen of every device matching the audience.
          </Text>

          {/* Audience picker */}
          <Text variant="tiny" color={colors.zinc500} style={styles.sectionLabel}>
            AUDIENCE
          </Text>
          <View style={styles.destRow}>
            {AUDIENCES.map((a) => {
              const on = audKind === a.value;
              const Icon = a.icon;
              return (
                <Pressable
                  key={a.value}
                  onPress={() => {
                    setAudKind(a.value);
                    clearFeedback();
                    if (a.value !== "user") {
                      setSelectedUser(null);
                      setUserMatches([]);
                      setUserQuery("");
                    }
                    if (a.value === "group" && !selectedGroupId && groups[0]) {
                      setSelectedGroupId(groups[0].id);
                    }
                  }}
                  style={[styles.audChip, on && styles.destChipActive]}
                >
                  <Icon
                    size={13}
                    color={on ? colors.emerald400 : colors.zinc400}
                  />
                  <Text
                    variant="tiny"
                    weight="600"
                    color={on ? colors.emerald400 : colors.zinc400}
                  >
                    {a.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Group picker */}
          {audKind === "group" ? (
            groups.length === 0 ? (
              <Text variant="small" color={colors.zinc500}>
                No user groups exist yet. Create one in Coupons → Groups on the
                web admin first.
              </Text>
            ) : (
              <View style={styles.groupList}>
                {groups.map((g: PushGroupOption) => {
                  const on = selectedGroupId === g.id;
                  return (
                    <Pressable
                      key={g.id}
                      onPress={() => {
                        setSelectedGroupId(g.id);
                        clearFeedback();
                      }}
                      style={[styles.groupRow, on && styles.groupRowActive]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          variant="small"
                          weight="600"
                          color={on ? colors.emerald400 : colors.foreground}
                        >
                          {g.name}
                        </Text>
                        <Text variant="tiny" color={colors.zinc500}>
                          {g.memberCount} member{g.memberCount === 1 ? "" : "s"} ·{" "}
                          {g.deviceCount} reachable
                        </Text>
                      </View>
                      {on ? (
                        <CheckCircle2 size={16} color={colors.emerald400} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            )
          ) : null}

          {/* User search */}
          {audKind === "user" ? (
            selectedUser ? (
              <View style={styles.selectedUser}>
                <View style={{ flex: 1 }}>
                  <Text variant="small" weight="600" color={colors.foreground}>
                    {selectedUser.name || selectedUser.phone || "Unnamed user"}
                  </Text>
                  <Text variant="tiny" color={colors.zinc500}>
                    {selectedUser.phone || "—"} · {selectedUser.deviceCount} device
                    {selectedUser.deviceCount === 1 ? "" : "s"}
                    {selectedUser.platforms.length > 0
                      ? ` (${selectedUser.platforms.join(", ")})`
                      : ""}
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    setSelectedUser(null);
                    setUserQuery("");
                  }}
                  hitSlop={8}
                >
                  <X size={18} color={colors.zinc400} />
                </Pressable>
              </View>
            ) : (
              <View>
                <Input
                  placeholder="Search by name or phone (≥2 chars)"
                  value={userQuery}
                  onChangeText={(t) => void runUserSearch(t)}
                  autoCapitalize="none"
                  autoCorrect={false}
                  trailingAddon={
                    searching ? (
                      <Loader2 size={14} color={colors.zinc500} />
                    ) : (
                      <Search size={14} color={colors.zinc500} />
                    )
                  }
                />
                {userMatches.length > 0 ? (
                  <View style={styles.userList}>
                    {userMatches.map((u) => (
                      <Pressable
                        key={u.id}
                        onPress={() => {
                          setSelectedUser(u);
                          setUserMatches([]);
                          clearFeedback();
                        }}
                        style={styles.userRow}
                      >
                        <View style={{ flex: 1 }}>
                          <Text variant="small" color={colors.foreground}>
                            {u.name || "Unnamed"}
                          </Text>
                          <Text variant="tiny" color={colors.zinc500}>
                            {u.phone || "—"}
                          </Text>
                        </View>
                        <Text variant="tiny" color={colors.zinc500}>
                          {u.deviceCount} device{u.deviceCount === 1 ? "" : "s"}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : userQuery.trim().length >= 2 && !searching ? (
                  <Text
                    variant="tiny"
                    color={colors.zinc600}
                    style={{ marginTop: spacing["2"] }}
                  >
                    No matches. Try a different query.
                  </Text>
                ) : null}
              </View>
            )
          ) : null}

          <Input
            label="Title"
            placeholder="e.g. Turf closed today due to rain"
            value={title}
            onChangeText={(t) => {
              setTitle(t);
              clearFeedback();
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
              clearFeedback();
            }}
            maxLength={BODY_MAX}
            multiline
            style={styles.bodyInput}
            hint={`${body.length}/${BODY_MAX}`}
          />

          <Text variant="tiny" color={colors.zinc500} style={styles.sectionLabel}>
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
                    clearFeedback();
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

          {/* Test-to-self — visually distinct (secondary, blue-ish copy),
              never touches customers. */}
          <Button
            label="Send test to my device"
            variant="secondary"
            onPress={() => {
              clearFeedback();
              testPush.mutate();
            }}
            disabled={busy}
            loading={testPush.isPending}
            fullWidth
            leadingIcon={
              testPush.isPending ? undefined : (
                <SmartphoneCharging size={15} color={colors.foreground} />
              )
            }
          />

          {/* Preview reach (dry-run) */}
          <Button
            label="Preview reach"
            variant="ghost"
            onPress={() => {
              clearFeedback();
              send.mutate(true);
            }}
            disabled={!canSend}
            loading={send.isPending}
            fullWidth
            leadingIcon={<Eye size={15} color={colors.foreground} />}
          />

          {/* Real broadcast */}
          <Button
            label={
              estReach !== null
                ? `Send broadcast to ${estReach} device${estReach === 1 ? "" : "s"}`
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
          <Text variant="tiny" color={colors.zinc500} style={styles.recentLabel}>
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

      <DevicesModal
        visible={devicesOpen}
        staleDevices={staleDevices}
        onClose={() => setDevicesOpen(false)}
        onChanged={() =>
          void qc.invalidateQueries({ queryKey: ["admin", "push", "overview"] })
        }
      />
    </Screen>
  );
}

// ── Device management modal ──────────────────────────────────────────
function DevicesModal({
  visible,
  staleDevices,
  onClose,
  onChanged,
}: {
  visible: boolean;
  staleDevices: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const devices = useQuery({
    queryKey: ["admin", "push", "devices"],
    queryFn: () => adminPushApi.devices({ limit: 50 }),
    enabled: visible,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => adminPushApi.revokeDevice(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "push", "devices"] });
      onChanged();
    },
    onError: (e) =>
      Alert.alert(
        "Could not revoke",
        e instanceof Error ? e.message : "Failed",
      ),
  });

  const prune = useMutation({
    mutationFn: () => adminPushApi.pruneStale(),
    onSuccess: (r) => {
      Alert.alert(
        "Done",
        `Pruned ${r.deleted} stale device${r.deleted === 1 ? "" : "s"}.`,
      );
      void qc.invalidateQueries({ queryKey: ["admin", "push", "devices"] });
      onChanged();
    },
    onError: (e) =>
      Alert.alert("Could not prune", e instanceof Error ? e.message : "Failed"),
  });

  const list = devices.data?.devices ?? [];

  function confirmRevoke(d: PushDevice) {
    Alert.alert(
      "Unregister device?",
      `Stop sending push notifications to ${
        d.userName || d.userPhone || "this user"
      }'s ${d.platform} device?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unregister",
          style: "destructive",
          onPress: () => revoke.mutate(d.id),
        },
      ],
    );
  }

  function confirmPrune() {
    Alert.alert(
      "Prune stale devices?",
      `Delete ${staleDevices} device${
        staleDevices === 1 ? "" : "s"
      } that haven't checked in for 90+ days?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Prune",
          style: "destructive",
          onPress: () => prune.mutate(),
        },
      ],
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHead}>
            <Text variant="title" weight="700">
              Registered devices
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={22} color={colors.zinc400} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.modalBody}>
            {devices.isLoading ? (
              <View style={styles.list}>
                {[0, 1, 2, 3].map((i) => (
                  <View key={i} style={styles.skeleton}>
                    <Skeleton width={140} height={14} />
                    <Skeleton width="60%" height={10} />
                  </View>
                ))}
              </View>
            ) : list.length === 0 ? (
              <Text
                variant="small"
                color={colors.zinc500}
                style={{ textAlign: "center", paddingVertical: spacing["8"] }}
              >
                No devices registered yet.
              </Text>
            ) : (
              <View style={styles.list}>
                {list.map((d) => (
                  <View key={d.id} style={styles.deviceRow}>
                    {d.platform === "ios" ? (
                      <Apple size={16} color={colors.zinc400} />
                    ) : d.platform === "android" ? (
                      <Smartphone size={16} color={colors.zinc400} />
                    ) : (
                      <Globe size={16} color={colors.zinc400} />
                    )}
                    <View style={{ flex: 1 }}>
                      <Text
                        variant="small"
                        color={colors.foreground}
                        numberOfLines={1}
                      >
                        {d.userName || d.userPhone || d.userId.slice(-8)}
                      </Text>
                      <Text variant="tiny" color={colors.zinc600} numberOfLines={1}>
                        {d.tokenPreview}
                        {d.appVersion ? ` · v${d.appVersion}` : ""} ·{" "}
                        {timeAgo(d.lastSeenAt)}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => confirmRevoke(d)}
                      hitSlop={8}
                      disabled={revoke.isPending}
                    >
                      <Trash2 size={16} color={colors.destructive} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
            {devices.data && devices.data.total > list.length ? (
              <Text
                variant="tiny"
                color={colors.zinc600}
                style={{ textAlign: "center", marginTop: spacing["3"] }}
              >
                Showing {list.length} of {devices.data.total}
              </Text>
            ) : null}
          </ScrollView>

          <View style={styles.modalFooter}>
            <Button
              label={
                staleDevices > 0
                  ? `Prune ${staleDevices} stale device${
                      staleDevices === 1 ? "" : "s"
                    }`
                  : "No stale devices to prune"
              }
              variant="destructive"
              onPress={confirmPrune}
              disabled={staleDevices === 0 || prune.isPending}
              loading={prune.isPending}
              fullWidth
              leadingIcon={<Trash2 size={15} color={colors.foreground} />}
            />
          </View>
        </View>
      </View>
    </Modal>
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
  manageRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  manageLeft: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  stalePill: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.warningSoft,
  },
  formCard: { padding: spacing["4"], gap: spacing["3"] },
  formHead: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  bodyInput: { minHeight: 84, textAlignVertical: "top", paddingTop: spacing["2"] },
  sectionLabel: {
    letterSpacing: 1.2,
    fontWeight: "700",
    marginTop: spacing["1"],
  },
  destRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing["2"] },
  destChip: {
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  audChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1"],
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
  groupList: { gap: spacing["2"] },
  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    padding: spacing["3"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  groupRowActive: {
    borderColor: colors.emerald400,
    backgroundColor: colors.emerald500_05,
  },
  selectedUser: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    padding: spacing["3"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_05,
  },
  userList: {
    marginTop: spacing["2"],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    overflow: "hidden",
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    padding: spacing["3"],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.zinc800_50,
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
  // Device modal
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: "85%",
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
  modalBody: { padding: spacing["5"] },
  modalFooter: {
    padding: spacing["5"],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    padding: spacing["3"],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
});
