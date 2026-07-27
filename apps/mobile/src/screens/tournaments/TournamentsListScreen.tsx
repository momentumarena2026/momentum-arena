import { useCallback } from "react";
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Trophy, Users, Radio } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius } from "../../theme";
import { fetchTournamentHub, type TournamentListItem } from "../../lib/tournaments";
import type { AccountStackParamList } from "../../navigation/types";

const SPORT_EMOJI: Record<string, string> = { CRICKET: "🏏", FOOTBALL: "⚽", PICKLEBALL: "🎾" };
const STATUS_LABEL: Record<string, string> = {
  PUBLISHED: "Coming soon",
  REG_OPEN: "Registrations open",
  REG_CLOSED: "Registrations closed",
  POOLS_REVEALED: "Pools out",
  LIVE: "LIVE",
  COMPLETED: "Completed",
};

export function TournamentsListScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<AccountStackParamList>>();
  const { data: hub, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["tournaments"],
    queryFn: fetchTournamentHub,
  });
  const data = hub?.tournaments;

  const open = useCallback(
    (t: TournamentListItem) => navigation.navigate("TournamentDetail", { slug: t.slug }),
    [navigation]
  );

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.emerald400} />}
      >
        {isLoading && (
          <View style={{ gap: 12 }}>
            <Skeleton height={140} />
            <Skeleton height={140} />
          </View>
        )}
        {!isLoading && (data?.length ?? 0) === 0 && (
          <View style={styles.empty}>
            <Trophy size={40} color={colors.zinc600} />
            <Text style={styles.emptyText}>No tournaments announced yet — stay tuned!</Text>
          </View>
        )}
        {data?.map((t) => (
          <Pressable
            key={t.id}
            onPress={() => open(t)}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
          >
            {t.bannerImageUrl ? (
              <Image source={{ uri: t.bannerImageUrl }} style={styles.banner} resizeMode="cover" />
            ) : (
              <View style={[styles.banner, styles.bannerFallback]}>
                <Text style={{ fontSize: 44 }}>{SPORT_EMOJI[t.sport] || "🏆"}</Text>
              </View>
            )}
            <View style={styles.cardBody}>
              <View style={styles.rowBetween}>
                <Text style={styles.name} numberOfLines={1}>
                  {t.name}
                </Text>
                <View
                  style={[
                    styles.statusChip,
                    t.status === "LIVE" && { borderColor: "rgba(248,113,113,0.5)", backgroundColor: "rgba(248,113,113,0.12)" },
                    t.status === "REG_OPEN" && { borderColor: colors.emerald500_30, backgroundColor: colors.emerald500_10 },
                  ]}
                >
                  {t.status === "LIVE" && <Radio size={10} color="#f87171" />}
                  <Text
                    style={[
                      styles.statusText,
                      t.status === "LIVE" && { color: "#f87171" },
                      t.status === "REG_OPEN" && { color: colors.emerald400 },
                    ]}
                  >
                    {STATUS_LABEL[t.status] || t.status}
                  </Text>
                </View>
              </View>
              <View style={styles.metaRow}>
                <View style={styles.metaItem}>
                  <Users size={13} color={colors.zinc500} />
                  <Text style={styles.metaText}>
                    {t.confirmedTeams}/{t.totalTeams} teams
                  </Text>
                </View>
                {t.prizePool ? (
                  <View style={styles.metaItem}>
                    <Trophy size={13} color="#fbbf24" />
                    <Text style={[styles.metaText, { color: "#fbbf24" }]}>
                      ₹{t.prizePool.toLocaleString("en-IN")}
                    </Text>
                  </View>
                ) : null}
                {t.feeMode !== "FREE" && t.entryFee > 0 && (
                  <Text style={styles.metaText}>₹{t.entryFee.toLocaleString("en-IN")}/team</Text>
                )}
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  empty: { alignItems: "center", paddingVertical: 60, gap: 12 },
  emptyText: { color: colors.zinc500, fontSize: 14 },
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  banner: { height: 120, width: "100%" },
  bannerFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.emerald500_05,
  },
  cardBody: { padding: 12, gap: 8 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  name: { color: colors.foreground, fontSize: 16, fontWeight: "700", flex: 1 },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusText: { fontSize: 11, color: colors.zinc400 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 12, color: colors.zinc400 },
});
