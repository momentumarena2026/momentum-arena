import { useCallback, useEffect, useMemo, useState } from "react";
import { TournamentBanner } from "../../components/TournamentBanner";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Trophy, Users, Radio } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  fetchTournamentHubPage,
  TOURNAMENT_GROUPS,
  TOURNAMENT_GROUP_LABEL,
  type TournamentGroup,
  type TournamentListItem,
} from "../../lib/tournaments";
import { trackTournamentHubView } from "../../lib/analytics";
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

const PAGE_SIZE = 10;

export function TournamentsListScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<AccountStackParamList>>();

  // Upcoming only, by default: the reason someone opens this screen is to
  // find something they can still enter. Ongoing and completed are one tap
  // away rather than padding the first screenful.
  const [selected, setSelected] = useState<TournamentGroup[]>(["UPCOMING"]);

  const {
    data,
    isLoading,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isError,
  } = useInfiniteQuery({
    // The filter is part of the key, so each combination caches on its own
    // and flipping back to a previous selection is instant.
    queryKey: ["tournaments", "paged", [...selected].sort().join(",")],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      fetchTournamentHubPage({
        groups: selected,
        offset: pageParam as number,
        limit: PAGE_SIZE,
      }),
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  });

  useEffect(() => {
    trackTournamentHubView();
  }, []);

  // Pages arrive already in priority order (upcoming → ongoing →
  // completed) from the server. Flattening is all the client does — any
  // client-side sort would only reorder within the pages already fetched
  // and would scramble the sequence at every page boundary.
  const items = useMemo(
    () => data?.pages.flatMap((p) => p.tournaments) ?? [],
    [data],
  );

  /**
   * Chips are multi-select, but the last one cannot be turned off:
   * deselecting everything leaves a screen that looks broken rather than
   * filtered. Tapping the only active chip is treated as a no-op.
   */
  const toggle = useCallback((g: TournamentGroup) => {
    setSelected((prev) => {
      if (prev.includes(g)) {
        return prev.length === 1 ? prev : prev.filter((x) => x !== g);
      }
      // Keep canonical priority order so the array reads the way the list
      // does, which makes the query key stable and the UI predictable.
      return TOURNAMENT_GROUPS.filter((x) => x === g || prev.includes(x));
    });
  }, []);

  const open = useCallback(
    (t: TournamentListItem) =>
      navigation.navigate("TournamentDetail", { slug: t.slug }),
    [navigation],
  );

  const renderCard = useCallback(
    ({ item: t }: { item: TournamentListItem }) => (
      <Pressable
        onPress={() => open(t)}
        style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
      >
        {t.bannerImageUrl ? (
          <TournamentBanner uri={t.bannerImageUrl} />
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
                t.status === "LIVE" && {
                  borderColor: "rgba(248,113,113,0.5)",
                  backgroundColor: "rgba(248,113,113,0.12)",
                },
                t.status === "REG_OPEN" && {
                  borderColor: colors.emerald500_30,
                  backgroundColor: colors.emerald500_10,
                },
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
              <Text style={styles.metaText}>
                ₹{t.entryFee.toLocaleString("en-IN")}/team
              </Text>
            )}
          </View>
          {/* Start date — the web card has always shown it and the app
              card didn't, so "when is it?" needed a tap. Pinned to IST
              because tournament times are venue wall-clock. */}
          {t.startDate && (
            <Text style={styles.dateText}>
              {new Date(t.startDate).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
                timeZone: "Asia/Kolkata",
              })}
            </Text>
          )}
        </View>
      </Pressable>
    ),
    [open],
  );

  const chips = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // style, NOT just contentContainerStyle: a horizontal ScrollView is
      // a flex child and will happily grow to fill the whole screen
      // height. With borderRadius 999 on the chips that turned three
      // pills into three large circles. flexGrow 0 pins the strip to its
      // content height; alignItems centre stops each chip stretching to
      // fill whatever height remains.
      style={styles.chipScroll}
      contentContainerStyle={styles.chipRow}
    >
      {TOURNAMENT_GROUPS.map((g) => {
        const active = selected.includes(g);
        return (
          <Pressable
            key={g}
            onPress={() => toggle(g)}
            style={({ pressed }) => [
              styles.chip,
              active && styles.chipActive,
              pressed && { opacity: 0.8 },
            ]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>
              {TOURNAMENT_GROUP_LABEL[g]}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  return (
    <Screen padded={false}>
      {chips}
      <FlatList
        data={items}
        keyExtractor={(t) => t.id}
        renderItem={renderCard}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching && !isFetchingNextPage}
            onRefresh={refetch}
            tintColor={colors.emerald400}
          />
        }
        // Fetch the next page a little before the last card is reached, so
        // the spinner rarely becomes the thing the user is looking at.
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        }}
        ListEmptyComponent={
          isLoading ? (
            <View style={{ gap: 12 }}>
              <Skeleton height={140} />
              <Skeleton height={140} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Trophy size={40} color={colors.zinc600} />
              <Text style={styles.emptyText}>
                {isError
                  ? "Couldn't load tournaments — pull to retry."
                  : selected.length === TOURNAMENT_GROUPS.length
                    ? "No tournaments announced yet — stay tuned!"
                    : `Nothing ${selected
                        .map((g) => TOURNAMENT_GROUP_LABEL[g].toLowerCase())
                        .join(" or ")} right now.`}
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={styles.footer}>
              <ActivityIndicator color={colors.emerald400} />
            </View>
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // padded={false} on <Screen> — this is the ONLY horizontal
  // padding, matching camps/passes at spacing 5. Leaving Screen
  // padded stacked 24 + 16 and made these screens 40px a side.
  content: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["2"],
    gap: 12,
    paddingBottom: 32,
  },
  chipScroll: { flexGrow: 0, flexShrink: 0 },
  chipRow: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["2"],
    gap: spacing["2"],
    alignItems: "center",
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 999,
    paddingHorizontal: spacing["4"],
    // Fixed height rather than vertical padding: it makes the pill shape
    // independent of the font metrics, which differ between iOS and
    // Android and were letting the chips grow taller than intended.
    height: 34,
    justifyContent: "center",
  },
  chipActive: {
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_10,
  },
  chipText: { fontSize: 13, color: colors.zinc400, fontWeight: "600" },
  chipTextActive: { color: colors.emerald400 },
  footer: { paddingVertical: 20 },
  dateText: { marginTop: 4, fontSize: 12, color: colors.zinc500 },
  empty: { alignItems: "center", paddingVertical: 60, gap: 12 },
  emptyText: { color: colors.zinc500, fontSize: 14, textAlign: "center" },
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  // Only the emoji fallback uses this now — a real banner sizes itself
  // from the artwork (TournamentBanner).
  banner: { height: 120, width: "100%" },
  bannerFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.emerald500_05,
  },
  cardBody: { padding: 12, gap: 8 },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
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
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 12, color: colors.zinc400 },
});
