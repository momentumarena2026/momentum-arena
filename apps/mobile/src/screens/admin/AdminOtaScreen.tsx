import { useMemo } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Package, Smartphone, ShieldAlert } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
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

function ReleaseRow({ r, isLive }: { r: OtaReleaseRow; isLive: boolean }) {
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

function GateCard({ gate }: { gate: AppVersionGateRow }) {
  const forcing = gate.minSupportedBuild > 0;
  return (
    <Card style={styles.slotCard}>
      <View style={styles.slotHead}>
        <ShieldAlert size={16} color={colors.zinc400} />
        <Text variant="bodyStrong" color={colors.foreground}>
          {platformLabel(gate.platform)}
        </Text>
        <Badge label={gate.channel} tone="primary" />
        <Badge
          label={forcing ? "Forcing update" : "Not forcing"}
          tone={forcing ? "warning" : "neutral"}
          style={{ marginLeft: "auto" }}
        />
      </View>
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
          Read-only status of over-the-air JS bundle releases for the{" "}
          {environment} mobile app. Roll outs are managed from the web admin.
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
              {PLATFORMS.map((p) => {
                const gate = gateSlots.get(p);
                return gate ? (
                  <GateCard key={p} gate={gate} />
                ) : (
                  <Card key={p} style={styles.slotCard}>
                    <View style={styles.slotHead}>
                      <ShieldAlert size={16} color={colors.zinc400} />
                      <Text variant="bodyStrong" color={colors.foreground}>
                        {platformLabel(p)}
                      </Text>
                      <Badge label={environment} tone="primary" />
                    </View>
                    <Text variant="tiny" color={colors.zinc600}>
                      No version gate configured. Set one from the web admin.
                    </Text>
                  </Card>
                );
              })}
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
