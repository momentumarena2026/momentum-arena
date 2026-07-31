import { useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Archive, Moon, Sparkles, Sun, Ticket } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../../components/ui/Screen";
import { BalanceRing } from "../../components/passes/BalanceRing";
import { Text } from "../../components/ui/Text";
import { colors, spacing } from "../../theme";
import { passesApi, type MyPassSummary } from "../../lib/passes";
import type { AccountStackParamList } from "../../navigation/types";

/**
 * My Passes — mobile mirror of the web /my-passes page. Active /
 * Inactive tabs, ticket cards with a balance ring (used vs remaining),
 * shared-by tags for member passes, and start/expiry meta.
 */

const SPORT_ACCENT: Record<string, string> = {
  CRICKET: "#34d399",
  FOOTBALL: "#60a5fa",
  PICKLEBALL: "#facc15",
};
const USED_COLOR = "#52525b"; // zinc-600

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  UPCOMING: "Upcoming",
  EXHAUSTED: "Used up",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

const fmtH = (m: number) => `${(m / 60).toFixed(1).replace(/\.0$/, "")}h`;
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const isLive = (s: string) => s === "ACTIVE" || s === "UPCOMING";

function PassTicket({
  pass,
  onPress,
}: {
  pass: MyPassSummary;
  onPress: () => void;
}) {
  const accent = SPORT_ACCENT[pass.sport] ?? "#34d399";
  const inactive = !isLive(pass.status);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.ticket,
        inactive && styles.ticketInactive,
        !inactive && { borderColor: `${accent}33` },
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={styles.ticketHeader}>
        <View
          style={[
            styles.statusPill,
            { backgroundColor: inactive ? colors.zinc800 : `${accent}22` },
          ]}
        >
          <Text
            style={[
              styles.statusPillText,
              { color: inactive ? colors.zinc400 : accent },
            ]}
          >
            {STATUS_LABEL[pass.status] ?? pass.status}
          </Text>
        </View>
        {pass.role === "member" && (
          <Text style={styles.sharedTag}>
            Shared by {pass.ownerName ?? "owner"}
          </Text>
        )}
      </View>

      <Text style={styles.ticketName} numberOfLines={2}>
        {pass.name}
      </Text>

      <View style={styles.ticketBody}>
        <BalanceRing
          total={pass.totalMinutes / 60}
          remaining={pass.remainingMinutes / 60}
          accent={accent}
          dim={inactive}
        />
        <View style={styles.legend}>
          <View style={styles.legendRow}>
            <View
              style={[
                styles.legendDot,
                { backgroundColor: inactive ? USED_COLOR : accent },
              ]}
            />
            <Text style={styles.legendText}>
              {fmtH(pass.remainingMinutes)} left
            </Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: USED_COLOR }]} />
            <Text style={styles.legendMuted}>
              {fmtH(pass.totalMinutes - pass.remainingMinutes)} used
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.ticketFooter}>
        <Text style={styles.footerText}>
          {pass.status === "UPCOMING"
            ? `Starts ${fmtDate(pass.startsAt)}`
            : `Expires ${fmtDate(pass.expiresAt)}`}
          {(pass.timeChips?.length ?? 0) === 0 &&
          pass.bandsSummary &&
          pass.bandsSummary !== "All hours"
            ? ` · ${pass.bandsSummary}`
            : ""}
        </Text>
        {(pass.timeChips?.length ?? 0) > 0
          ? pass.timeChips!.map((c) => (
              <View
                key={c.label}
                style={[
                  styles.timeChip,
                  c.tone === "day" ? styles.timeChipDay : styles.timeChipNight,
                ]}
              >
                {c.tone === "day" ? (
                  <Sun size={11} color="#7dd3fc" />
                ) : (
                  <Moon size={11} color={colors.zinc300} />
                )}
                <Text
                  style={[
                    styles.timeChipText,
                    { color: c.tone === "day" ? "#7dd3fc" : colors.zinc300 },
                  ]}
                >
                  {c.label}
                </Text>
              </View>
            ))
          : null}
        <Text style={styles.footerLink}>Details ›</Text>
      </View>
    </Pressable>
  );
}

export function MyPassesScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<AccountStackParamList>>();
  const [tab, setTab] = useState<"active" | "inactive">("active");
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["my-passes"],
    queryFn: () => passesApi.myPasses(),
  });

  const passes = data?.passes ?? [];
  const active = passes.filter((p) => isLive(p.status));
  const inactive = passes.filter((p) => !isLive(p.status));
  const shown = tab === "active" ? active : inactive;

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
      {/* Tabs + storefront entry */}
      <View style={styles.topRow}>
      <View style={styles.tabsRow}>
        {(
          [
            { key: "active", label: "Active", count: active.length },
            { key: "inactive", label: "Inactive", count: inactive.length },
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
            <View style={[styles.tabCount, tab === t.key && styles.tabCountOn]}>
              <Text
                style={[
                  styles.tabCountText,
                  tab === t.key && styles.tabCountTextOn,
                ]}
              >
                {t.count}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
      {data?.storefrontEnabled ? (
        <Pressable
          onPress={() => navigation.navigate("PassesStore")}
          style={({ pressed }) => [styles.buyBtn, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.buyBtnText}>+ Buy</Text>
        </Pressable>
      ) : null}
      </View>

      {isLoading ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>Loading your passes…</Text>
        </View>
      ) : shown.length === 0 ? (
        tab === "active" ? (
          <View style={styles.emptyBox}>
            <View style={styles.emptyIcon}>
              <Ticket size={30} color={colors.emerald400} />
            </View>
            <Text style={styles.emptyTitle}>Your passes will live here</Text>
            <Text style={styles.emptySub}>
              Buy hours in bulk at a lower rate, share them with your squad,
              and let the pass pay at checkout.
            </Text>
            {data?.storefrontEnabled ? (
              <Pressable
                onPress={() => navigation.navigate("PassesStore")}
                style={({ pressed }) => [
                  styles.emptyCta,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Sparkles size={14} color="#022c22" />
                <Text style={styles.emptyCtaText}>Browse passes</Text>
              </Pressable>
            ) : (
              <View style={styles.emptyHint}>
                <Sparkles size={14} color={colors.emerald400} />
                <Text style={styles.emptyHintText}>
                  Passes are coming soon — watch this space.
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.emptyBox}>
            <Archive size={28} color={colors.zinc600} />
            <Text style={styles.emptyTitle}>No inactive passes</Text>
            <Text style={styles.emptySub}>
              Passes you cancel, use up, or let expire are archived here.
            </Text>
          </View>
        )
      ) : (
        <View style={styles.list}>
          {shown.map((p) => (
            <PassTicket
              key={p.id}
              pass={p}
              onPress={() => navigation.navigate("PassDetail", { passId: p.id })}
            />
          ))}
        </View>
      )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing["4"],
    paddingBottom: spacing["8"],
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing["4"],
  },
  tabsRow: {
    flexDirection: "row",
    gap: spacing["2"],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: "rgba(24,24,27,0.6)",
    padding: 4,
    alignSelf: "flex-start",
  },
  buyBtn: {
    borderRadius: 10,
    backgroundColor: colors.emerald500,
    paddingHorizontal: spacing["3"],
    paddingVertical: 8,
  },
  buyBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#022c22",
  },
  tabBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 8,
    paddingHorizontal: spacing["3"],
    paddingVertical: 6,
  },
  tabBtnOn: {
    backgroundColor: "rgba(16,185,129,0.15)",
  },
  tabText: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.zinc400,
  },
  tabTextOn: {
    color: "#6ee7b7",
  },
  tabCount: {
    borderRadius: 999,
    backgroundColor: colors.zinc800,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  tabCountOn: {
    backgroundColor: "rgba(16,185,129,0.20)",
  },
  tabCountText: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.zinc500,
  },
  tabCountTextOn: {
    color: "#6ee7b7",
  },

  list: {
    gap: spacing["3"],
  },
  ticket: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["4"],
  },
  ticketInactive: {
    opacity: 0.7,
  },
  ticketHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing["2"],
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: spacing["2"],
    paddingVertical: 3,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  sharedTag: {
    fontSize: 11,
    color: "#7dd3fc",
  },
  ticketName: {
    marginTop: spacing["2"],
    fontSize: 16,
    fontWeight: "600",
    color: colors.foreground,
  },
  ticketBody: {
    marginTop: spacing["3"],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["5"],
  },
  ringCenter: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  ringHours: {
    fontSize: 20,
    fontWeight: "700",
  },
  ringSub: {
    marginTop: 1,
    fontSize: 11,
    color: colors.zinc500,
  },
  legend: {
    gap: spacing["2"],
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 13,
    color: colors.foreground,
  },
  legendMuted: {
    fontSize: 13,
    color: colors.zinc500,
  },
  ticketFooter: {
    marginTop: spacing["3"],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.zinc800,
    paddingTop: spacing["2"],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  timeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginLeft: 6,
  },
  timeChipDay: {
    backgroundColor: "rgba(14,165,233,0.15)",
  },
  timeChipNight: {
    backgroundColor: "rgba(63,63,70,0.6)",
  },
  timeChipText: {
    fontSize: 10,
    fontWeight: "700",
  },
  footerText: {
    flex: 1,
    fontSize: 11,
    color: colors.zinc500,
  },
  footerLink: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6ee7b7",
  },

  emptyBox: {
    alignItems: "center",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.20)",
    backgroundColor: "rgba(24,24,27,0.5)",
    paddingVertical: 48,
    paddingHorizontal: spacing["6"],
    gap: spacing["2"],
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(16,185,129,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing["2"],
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.foreground,
    textAlign: "center",
  },
  emptySub: {
    fontSize: 13,
    color: colors.zinc500,
    textAlign: "center",
    lineHeight: 19,
    maxWidth: 300,
  },
  emptyHint: {
    marginTop: spacing["3"],
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  emptyHintText: {
    fontSize: 12,
    color: "#6ee7b7",
  },
  emptyCta: {
    marginTop: spacing["3"],
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 12,
    backgroundColor: colors.emerald500,
    paddingHorizontal: spacing["4"],
    paddingVertical: 10,
  },
  emptyCtaText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#022c22",
  },
});
