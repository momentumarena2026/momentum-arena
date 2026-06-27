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
import { FileText } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminReportsApi,
  REPORT_TYPES,
  type AdminReport,
  type ReportStatus,
  type ReportType,
} from "../../lib/admin-reports";
import { AdminApiError } from "../../lib/admin-api";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const STATUS_TONE: Record<ReportStatus, string> = {
  QUEUED: colors.zinc400,
  GENERATING: colors.warning,
  READY: colors.emerald400,
  FAILED: colors.destructive,
  EXPIRED: colors.zinc600,
};

function fmtSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function typeLabel(t: ReportType): string {
  return REPORT_TYPES.find((r) => r.value === t)?.label ?? t;
}

export function AdminReportsScreen() {
  const qc = useQueryClient();
  const now = new Date();
  const [type, setType] = useState<ReportType>("SALES_MONTHLY");
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [err, setErr] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["admin", "reports"],
    queryFn: () => adminReportsApi.list(),
    // Poll while anything is mid-generation so the row flips to READY live.
    refetchInterval: (q) => {
      const rows = q.state.data?.reports ?? [];
      return rows.some((r) => r.status === "QUEUED" || r.status === "GENERATING")
        ? 4000
        : false;
    },
  });

  const enqueue = useMutation({
    mutationFn: () => adminReportsApi.enqueue(type, Number(year), Number(month)),
    onSuccess: () => {
      setErr(null);
      Alert.alert("Queued", "Report queued — it'll appear below when ready.");
      void qc.invalidateQueries({ queryKey: ["admin", "reports"] });
    },
    onError: (e) =>
      setErr(e instanceof AdminApiError || e instanceof Error ? e.message : "Failed"),
  });

  const reports = list.data?.reports ?? [];

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
        {/* Generate */}
        <Card style={styles.card}>
          <Text variant="bodyStrong" color={colors.foreground}>
            Generate a report
          </Text>
          <Text variant="tiny" color={colors.zinc500} style={styles.label}>
            REPORT TYPE
          </Text>
          <View style={styles.typeWrap}>
            {REPORT_TYPES.map((t) => (
              <Pressable
                key={t.value}
                onPress={() => setType(t.value)}
                style={[styles.typeChip, type === t.value && styles.typeChipActive]}
              >
                <Text
                  variant="tiny"
                  weight="600"
                  color={type === t.value ? colors.emerald400 : colors.zinc400}
                >
                  {t.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.twoCol}>
            <View style={{ flex: 1 }}>
              <Input label="Year" keyboardType="number-pad" maxLength={4} value={year} onChangeText={setYear} />
            </View>
            <View style={{ flex: 1 }}>
              <Input label="Month (1-12)" keyboardType="number-pad" maxLength={2} value={month} onChangeText={setMonth} />
            </View>
          </View>
          <Text variant="tiny" color={colors.zinc600}>
            Lifetime reports ignore the month. Download the finished file from the
            web admin.
          </Text>
          {err ? (
            <Text variant="small" color={colors.destructive} style={{ marginTop: spacing["1"] }}>
              {err}
            </Text>
          ) : null}
          <Button
            label="Generate report"
            onPress={() => enqueue.mutate()}
            loading={enqueue.isPending}
            fullWidth
          />
        </Card>

        {/* History */}
        <Text variant="tiny" color={colors.zinc500} style={styles.section}>
          RECENT REPORTS
        </Text>
        {list.isLoading ? (
          <View style={styles.list}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} width="100%" height={58} />
            ))}
          </View>
        ) : reports.length === 0 ? (
          <View style={styles.empty}>
            <FileText size={32} color={colors.zinc600} />
            <Text variant="small" color={colors.zinc500} style={{ marginTop: spacing["2"] }}>
              No reports generated yet.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {reports.map((r: AdminReport) => (
              <Card key={r.id} style={styles.reportRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="small" weight="600" color={colors.foreground}>
                    {typeLabel(r.type)}
                  </Text>
                  <Text variant="tiny" color={colors.zinc500}>
                    {MONTHS[(r.month - 1) % 12]} {r.year}
                    {r.fileSizeBytes ? ` · ${fmtSize(r.fileSizeBytes)}` : ""} ·{" "}
                    {r.requestedByUsername}
                  </Text>
                  {r.status === "FAILED" && r.errorMessage ? (
                    <Text variant="tiny" color={colors.destructive}>
                      {r.errorMessage}
                    </Text>
                  ) : null}
                  {r.status === "READY" ? (
                    <Text variant="tiny" color={colors.zinc600}>
                      Download from web admin
                    </Text>
                  ) : null}
                </View>
                <View style={[styles.statusPill, { borderColor: STATUS_TONE[r.status] }]}>
                  <Text variant="tiny" weight="700" color={STATUS_TONE[r.status]}>
                    {r.status}
                  </Text>
                </View>
              </Card>
            ))}
          </View>
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
  card: { padding: spacing["4"], gap: spacing["2"] },
  label: { letterSpacing: 1.2, fontWeight: "700", marginTop: spacing["1"] },
  section: { letterSpacing: 1.2, fontWeight: "700", marginTop: spacing["3"] },
  typeWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing["2"] },
  typeChip: {
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  typeChipActive: { borderColor: colors.emerald400, backgroundColor: colors.emerald500_10 },
  twoCol: { flexDirection: "row", gap: spacing["3"] },
  list: { gap: spacing["2"] },
  reportRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    padding: spacing["4"],
  },
  statusPill: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  empty: { alignItems: "center", paddingVertical: spacing["10"] },
});
