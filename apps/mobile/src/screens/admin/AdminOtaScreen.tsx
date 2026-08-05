import { useMemo, useState } from "react";
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
  Package,
  Smartphone,
  ShieldAlert,
  Rocket,
  Undo2,
  Archive,
  ShieldOff,
  Save,
  Pencil,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import { formatDate } from "../../lib/format";
import { AdminApiError } from "../../lib/admin-api";
import {
  adminOtaApi,
  type AppVersionGateRow,
  type OtaPlatform,
  type OtaReleaseRow,
  type OtaReleaseStatus,
} from "../../lib/admin-ota";

const PLATFORMS: OtaPlatform[] = ["ios", "android"];

const STATUS_TONE: Record<
  OtaReleaseStatus,
  "neutral" | "success" | "warning" | "destructive" | "primary"
> = {
  DRAFT: "neutral",
  PUBLISHED: "success",
  ARCHIVED: "neutral",
};

const STATUS_LABEL: Record<OtaReleaseStatus, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

function platformLabel(p: OtaPlatform) {
  return p === "ios" ? "iOS" : "Android";
}

/** The rollout ladder — go up a rung, watch, go up again. */
const ROLLOUT_STEPS = [20, 40, 60, 80, 100] as const;

function RolloutBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <View style={styles.rolloutRow}>
      <View style={styles.rolloutTrack}>
        <View style={[styles.rolloutFill, { width: `${clamped}%` }]} />
      </View>
      <Text variant="tiny" color={colors.zinc300}>
        {clamped}%
      </Text>
    </View>
  );
}

/**
 * One OTA release card with its actions:
 *  - DRAFT/ARCHIVED → "Roll out" reveals a % input (default 100) → publishes.
 *  - PUBLISHED      → "Set %" reveals a % input → adjusts rollout; plus
 *                     "Roll back" and "Archive" (confirmed via Alert).
 * Mutations invalidate the ["admin","ota"] query on success.
 */
function ReleaseRow({ r, isLive }: { r: OtaReleaseRow; isLive: boolean }) {
  const queryClient = useQueryClient();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "ota"] });

  const onMutationError = (verb: string) => (err: unknown) =>
    Alert.alert(
      `Couldn't ${verb}`,
      err instanceof AdminApiError || err instanceof Error
        ? err.message
        : "Try again.",
    );

  const rolloutM = useMutation({
    mutationFn: (percent: number) => adminOtaApi.rollout(r.id, percent),
    onSuccess: () => {
      void invalidate();
    },
    onError: onMutationError("roll out"),
  });
  const setPctM = useMutation({
    mutationFn: (percent: number) => adminOtaApi.setPercent(r.id, percent),
    onSuccess: () => {
      void invalidate();
    },
    onError: onMutationError("set rollout %"),
  });
  const rollbackM = useMutation({
    mutationFn: () => adminOtaApi.rollback(r.id),
    onSuccess: () => void invalidate(),
    onError: onMutationError("roll back"),
  });
  const archiveM = useMutation({
    mutationFn: () => adminOtaApi.archive(r.id),
    onSuccess: () => void invalidate(),
    onError: onMutationError("archive"),
  });

  const pending =
    rolloutM.isPending ||
    setPctM.isPending ||
    rollbackM.isPending ||
    archiveM.isPending;

  // Same rung either way: a DRAFT publishes at it, a PUBLISHED release
  // moves to it — so the control doesn't change shape once it goes live.
  const goTo = (percent: number) => {
    if (r.status === "PUBLISHED") setPctM.mutate(percent);
    else rolloutM.mutate(percent);
  };


  const confirmRollback = () =>
    Alert.alert(
      "Roll back this release?",
      "It will be archived and the previous build re-published at 100%.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Roll back",
          style: "destructive",
          onPress: () => rollbackM.mutate(),
        },
      ],
    );

  const confirmArchive = () =>
    Alert.alert(
      "Archive this release?",
      "It will no longer be served.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          style: "destructive",
          onPress: () => archiveM.mutate(),
        },
      ],
    );

  return (
    <View style={styles.release}>
      <View style={styles.releaseHead}>
        <Text variant="small" weight="600" color={colors.foreground}>
          OTA #{r.sequence}
        </Text>
        {r.kind === "ROLLBACK" ? <Badge label="Rollback" tone="warning" /> : null}
        <Badge label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} />
        {isLive ? <Badge label="Live" tone="success" /> : null}
      </View>
      <Text variant="tiny" color={colors.zinc500}>
        rt {r.runtimeVersion} · {r.id.slice(0, 8)} · {formatDate(r.createdAt)}
      </Text>
      {r.status === "PUBLISHED" ? <RolloutBar percent={r.rolloutPercent} /> : null}
      {r.changelog ? (
        <Text variant="tiny" color={colors.zinc400} numberOfLines={3}>
          {r.changelog}
        </Text>
      ) : null}

      {/* Rollout ladder — one tap per rung. Publishing is a staged
          decision, not a number to type on a phone keyboard. */}
      <View style={styles.stepRow}>
        <Text variant="tiny" color={colors.zinc500}>
          {r.status === "PUBLISHED" ? "Now at" : "Publish at"}
        </Text>
        {ROLLOUT_STEPS.map((step) => {
          const current = r.status === "PUBLISHED" && r.rolloutPercent === step;
          return (
            <Pressable
              key={step}
              disabled={pending || current}
              onPress={() => goTo(step)}
              style={[styles.stepBtn, current && styles.stepBtnOn]}
            >
              <Text variant="tiny" weight="700" color={colors.emerald400}>
                {step}%
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Actions */}
      <View style={styles.actionRow}>
        {r.status === "PUBLISHED" && r.rolloutPercent !== 0 ? (
          <Button
            label="Pause"
            size="sm"
            variant="secondary"
            disabled={pending}
            onPress={() => goTo(0)}
          />
        ) : null}
        {r.status === "PUBLISHED" ? (
          <Button
            label="Roll back"
            size="sm"
            variant="secondary"
            loading={rollbackM.isPending}
            disabled={pending}
            leadingIcon={<Undo2 size={14} color={colors.warning} />}
            onPress={confirmRollback}
          />
        ) : null}
        {r.status !== "ARCHIVED" ? (
          <Button
            label="Archive"
            size="sm"
            variant="secondary"
            loading={archiveM.isPending}
            disabled={pending}
            leadingIcon={<Archive size={14} color={colors.zinc400} />}
            onPress={confirmArchive}
          />
        ) : null}
      </View>
    </View>
  );
}

function SlotCard({
  platform,
  channel,
  rows,
}: {
  platform: OtaPlatform;
  channel: string;
  rows: OtaReleaseRow[];
}) {
  const live = rows.find((r) => r.status === "PUBLISHED");
  return (
    <Card style={styles.slotCard}>
      <View style={styles.slotHead}>
        <Smartphone size={16} color={colors.zinc400} />
        <Text variant="bodyStrong" color={colors.foreground}>
          {platformLabel(platform)}
        </Text>
        <Badge label={channel} tone="primary" />
        <Text variant="tiny" color={colors.zinc500} style={{ marginLeft: "auto" }}>
          {rows.length} release{rows.length !== 1 ? "s" : ""}
        </Text>
      </View>
      {live ? (
        <Text variant="tiny" color={colors.emerald400}>
          Live · OTA #{live.sequence} · {live.rolloutPercent}%
        </Text>
      ) : (
        <Text variant="tiny" color={colors.zinc500}>
          No live release
        </Text>
      )}
      {rows.length === 0 ? (
        <Text variant="tiny" color={colors.zinc600} style={{ marginTop: spacing["1"] }}>
          No releases in this slot.
        </Text>
      ) : (
        <View style={styles.releaseList}>
          {rows.slice(0, 6).map((r) => (
            <ReleaseRow key={r.id} r={r} isLive={live?.id === r.id} />
          ))}
          {rows.length > 6 ? (
            <Text variant="tiny" color={colors.zinc600}>
              + {rows.length - 6} more — see web admin for full history.
            </Text>
          ) : null}
        </View>
      )}
    </Card>
  );
}

/**
 * One native version-gate card. Keeps the read summary, and adds an editable
 * form (latest build / version name / message / min supported build) saved via
 * `saveGate`, plus a Force-update / Un-force control mirroring the web editor.
 */
function GateCard({
  gate,
  platform,
  channel,
}: {
  gate: AppVersionGateRow | null;
  platform: OtaPlatform;
  channel: string;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const [latestBuild, setLatestBuild] = useState(String(gate?.latestBuild ?? ""));
  const [latestVersionName, setLatestVersionName] = useState(
    gate?.latestVersionName ?? "",
  );
  const [message, setMessage] = useState(gate?.message ?? "");
  const [minBuild, setMinBuild] = useState(String(gate?.minSupportedBuild ?? ""));

  // Match web: a gate only "forces" when the minimum supported build has
  // caught up to the latest build (min >= latest), not merely when min > 0.
  const forcing =
    !!gate && gate.latestBuild > 0 && gate.minSupportedBuild >= gate.latestBuild;
  // Uploaded to the store but not downloadable yet (review / Play draft), so
  // the app deliberately shows no update prompt.
  const awaitingStore = !!gate && gate.latestBuild > 0 && !gate.latestIsLive;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "ota"] });

  const onMutationError = (verb: string) => (err: unknown) =>
    Alert.alert(
      `Couldn't ${verb}`,
      err instanceof AdminApiError || err instanceof Error
        ? err.message
        : "Try again.",
    );

  const saveM = useMutation({
    mutationFn: (input: {
      latestBuild: number;
      latestVersionName: string;
      message: string;
      minSupportedBuild: number;
    }) =>
      adminOtaApi.saveGate({
        platform,
        channel,
        latestBuild: input.latestBuild,
        latestVersionName: input.latestVersionName,
        // The upsert action requires a store URL; reuse the gate's existing
        // one (the store link is managed from the web admin).
        storeUrl: gate?.storeUrl ?? "",
        message: input.message,
        minSupportedBuild: input.minSupportedBuild,
      }),
    onSuccess: () => {
      setEditing(false);
      void invalidate();
    },
    onError: onMutationError("save gate"),
  });
  const forceM = useMutation({
    mutationFn: () => adminOtaApi.forceUpdate(platform, channel),
    onSuccess: () => void invalidate(),
    onError: onMutationError("force update"),
  });
  // Manual override for the hourly store-availability checker.
  const storeLiveM = useMutation({
    mutationFn: (isLive: boolean) =>
      adminOtaApi.setStoreLive(platform, channel, isLive),
    onSuccess: () => void invalidate(),
    onError: onMutationError("update store availability"),
  });
  const unforceM = useMutation({
    mutationFn: () => adminOtaApi.unforce(platform, channel),
    onSuccess: () => void invalidate(),
    onError: onMutationError("un-force"),
  });

  const pending =
    saveM.isPending ||
    forceM.isPending ||
    unforceM.isPending ||
    storeLiveM.isPending;

  const submit = () => {
    const build = parseInt(latestBuild, 10);
    if (isNaN(build) || build < 0) {
      Alert.alert("Invalid build", "Enter a valid latest build number.");
      return;
    }
    const min = minBuild.trim() === "" ? 0 : parseInt(minBuild, 10);
    if (isNaN(min) || min < 0) {
      Alert.alert("Invalid minimum", "Enter a valid minimum supported build.");
      return;
    }
    saveM.mutate({
      latestBuild: build,
      latestVersionName,
      message,
      minSupportedBuild: min,
    });
  };

  const cancelEdit = () => {
    setEditing(false);
    setLatestBuild(String(gate?.latestBuild ?? ""));
    setLatestVersionName(gate?.latestVersionName ?? "");
    setMessage(gate?.message ?? "");
    setMinBuild(String(gate?.minSupportedBuild ?? ""));
  };

  const onForce = () =>
    Alert.alert(
      "Force update — set minimum = latest?",
      "Only do this AFTER the new build is live on the App Store / Play Store, or you'll lock users out.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Force update",
          style: "destructive",
          onPress: () => forceM.mutate(),
        },
      ],
    );

  const onUnforce = () =>
    Alert.alert(
      "Un-force update?",
      "Existing installs will no longer be blocked from using the app.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Un-force", onPress: () => unforceM.mutate() },
      ],
    );

  return (
    <Card style={styles.slotCard}>
      <View style={styles.slotHead}>
        <ShieldAlert size={16} color={colors.zinc400} />
        <Text variant="bodyStrong" color={colors.foreground}>
          {platformLabel(platform)}
        </Text>
        <Badge label={channel} tone="primary" />
        <Badge
          label={forcing ? "Forcing update" : "Not forcing"}
          tone={forcing ? "warning" : "neutral"}
          style={{ marginLeft: "auto" }}
        />
      </View>

      {!gate ? (
        <Text variant="tiny" color={colors.zinc600}>
          No version gate configured yet. Create one below.
        </Text>
      ) : !editing ? (
        <>
          <Text variant="tiny" color={colors.zinc400}>
            Latest build {gate.latestBuild}
            {gate.latestVersionName ? ` (${gate.latestVersionName})` : ""} · min
            supported {gate.minSupportedBuild}
          </Text>
          {gate.message ? (
            <Text variant="tiny" color={colors.zinc500} numberOfLines={2}>
              “{gate.message}”
            </Text>
          ) : null}
          <Text variant="tiny" color={colors.zinc600}>
            Updated {formatDate(gate.updatedAt)}
          </Text>
        </>
      ) : null}

      {/* Edit / create form */}
      {editing ? (
        <View style={styles.gateForm}>
          <Input
            label="Latest build (number)"
            keyboardType="number-pad"
            value={latestBuild}
            onChangeText={setLatestBuild}
            placeholder="e.g. 12"
          />
          <Input
            label="Latest version name"
            value={latestVersionName}
            onChangeText={setLatestVersionName}
            placeholder="e.g. 1.0.0"
          />
          <Input
            label="Min supported build"
            keyboardType="number-pad"
            value={minBuild}
            onChangeText={setMinBuild}
            placeholder="0 = nobody blocked"
          />
          <Input
            label="Message (optional)"
            value={message}
            onChangeText={setMessage}
            placeholder="Custom copy for the update prompt"
            multiline
          />
          <View style={styles.actionRow}>
            <Button
              label={gate ? "Save changes" : "Create gate"}
              size="sm"
              variant="primary"
              loading={saveM.isPending}
              disabled={pending}
              leadingIcon={<Save size={14} color="#032016" />}
              onPress={submit}
            />
            <Button
              label="Cancel"
              size="sm"
              variant="ghost"
              disabled={pending}
              onPress={cancelEdit}
            />
          </View>
        </View>
      ) : (
        <View style={styles.actionRow}>
          {awaitingStore ? (
            <View style={styles.awaitingBox}>
              <Text style={styles.awaitingTitle}>
                Build {gate!.latestBuild}
                {gate!.latestVersionName ? ` (${gate!.latestVersionName})` : ""}{" "}
                is uploaded but not on the store yet
              </Text>
              <Text style={styles.awaitingBody}>
                No update prompt is shown while it's in review — clears
                automatically within the hour once the store publishes it.
              </Text>
              <Button
                label="Mark live on store now"
                size="sm"
                variant="secondary"
                loading={storeLiveM.isPending}
                disabled={pending}
                onPress={() => storeLiveM.mutate(true)}
              />
            </View>
          ) : null}
          <Button
            label={gate ? "Edit" : "Create gate"}
            size="sm"
            variant="secondary"
            disabled={pending}
            leadingIcon={<Pencil size={14} color={colors.foreground} />}
            onPress={() => setEditing(true)}
          />
          {gate && !forcing ? (
            <Button
              label="Force update — set minimum = latest"
              size="sm"
              variant="destructive"
              loading={forceM.isPending}
              disabled={pending || gate.latestBuild <= 0}
              leadingIcon={<ShieldAlert size={14} color="#fff" />}
              onPress={onForce}
            />
          ) : null}
          {gate && forcing ? (
            <Button
              label="Un-force (lower minimum to 0)"
              size="sm"
              variant="secondary"
              loading={unforceM.isPending}
              disabled={pending}
              leadingIcon={<ShieldOff size={14} color={colors.foreground} />}
              onPress={onUnforce}
            />
          ) : null}
        </View>
      )}
    </Card>
  );
}

export function AdminOtaScreen() {
  const q = useQuery({
    queryKey: ["admin", "ota"],
    queryFn: () => adminOtaApi.status(),
  });

  const environment = q.data?.environment ?? "development";

  // Index releases by platform (already newest-first per slot from the API).
  const releaseSlots = useMemo(() => {
    const map = new Map<OtaPlatform, OtaReleaseRow[]>();
    for (const p of PLATFORMS) map.set(p, []);
    for (const r of q.data?.releases ?? []) {
      map.get(r.platform)?.push(r);
    }
    return map;
  }, [q.data]);

  const gateSlots = useMemo(() => {
    const map = new Map<OtaPlatform, AppVersionGateRow>();
    for (const g of q.data?.gates ?? []) map.set(g.platform, g);
    return map;
  }, [q.data]);

  const errMsg =
    q.error instanceof AdminApiError || q.error instanceof Error
      ? q.error.message
      : null;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={q.isRefetching && !q.isLoading}
            onRefresh={() => void q.refetch()}
            tintColor={colors.zinc400}
          />
        }
      >
        <View style={styles.headerRow}>
          <Text variant="title" weight="700" color={colors.foreground}>
            OTA Updates
          </Text>
          <Badge
            label={`${environment} env`}
            tone={environment === "production" ? "destructive" : "primary"}
          />
        </View>
        <Text variant="small" color={colors.zinc400}>
          Manage over-the-air JS bundle rollouts and the native version gate for
          the {environment} mobile app.
        </Text>

        {q.isLoading ? (
          <View style={styles.list}>
            {[0, 1].map((i) => (
              <Skeleton key={i} width="100%" height={120} />
            ))}
          </View>
        ) : errMsg ? (
          <Card style={styles.slotCard}>
            <Text variant="small" color={colors.destructive}>
              {errMsg}
            </Text>
          </Card>
        ) : (
          <>
            <Text variant="tiny" color={colors.zinc500} style={styles.sectionLabel}>
              OTA RELEASES
            </Text>
            {q.data && q.data.releases.length === 0 ? (
              <View style={styles.empty}>
                <Package size={32} color={colors.zinc600} />
                <Text
                  variant="small"
                  color={colors.zinc500}
                  style={{ marginTop: spacing["2"] }}
                >
                  No OTA releases yet.
                </Text>
              </View>
            ) : (
              <View style={styles.list}>
                {PLATFORMS.map((p) => (
                  <SlotCard
                    key={p}
                    platform={p}
                    channel={environment}
                    rows={releaseSlots.get(p) ?? []}
                  />
                ))}
              </View>
            )}

            <Text variant="tiny" color={colors.zinc500} style={styles.sectionLabel}>
              NATIVE VERSION GATE
            </Text>
            <View style={styles.list}>
              {PLATFORMS.map((p) => (
                <GateCard
                  key={p}
                  gate={gateSlots.get(p) ?? null}
                  platform={p}
                  channel={environment}
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["10"],
    gap: spacing["3"],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
  },
  sectionLabel: {
    letterSpacing: 1.2,
    fontWeight: "700",
    marginTop: spacing["3"],
  },
  list: { gap: spacing["3"] },
  slotCard: { padding: spacing["4"], gap: spacing["2"] },
  slotHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  releaseList: {
    gap: spacing["3"],
    marginTop: spacing["1"],
  },
  release: {
    gap: spacing["1"],
    paddingTop: spacing["2"],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  releaseHead: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing["2"],
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing["2"],
    marginTop: spacing["1"],
  },
  awaitingBox: {
    width: "100%",
    gap: spacing["2"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.30)",
    backgroundColor: "rgba(245,158,11,0.10)",
    padding: spacing["3"],
  },
  awaitingTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#fcd34d",
  },
  awaitingBody: {
    fontSize: 11,
    lineHeight: 16,
    color: "rgba(253,230,138,0.75)",
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 10,
  },
  stepBtn: {
    minWidth: 46,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_10,
  },
  stepBtnOn: {
    borderColor: "rgba(16,185,129,0.55)",
    backgroundColor: "rgba(16,185,129,0.22)",
  },
  gateForm: {
    gap: spacing["2"],
    marginTop: spacing["1"],
  },
  rolloutRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  rolloutTrack: {
    height: 6,
    width: 80,
    borderRadius: radius.full,
    backgroundColor: colors.zinc800,
    overflow: "hidden",
  },
  rolloutFill: {
    height: "100%",
    borderRadius: radius.full,
    backgroundColor: colors.emerald500,
  },
  empty: { alignItems: "center", paddingVertical: spacing["10"] },
});
