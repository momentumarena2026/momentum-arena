import { useCallback, useMemo, useState } from "react";
import { View, ScrollView, Pressable, RefreshControl, Alert } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Swords, Plus, ChevronRight } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { colors, radius } from "../../theme";
import type { AccountStackParamList } from "../../navigation/types";
import {
  fetchChallengeBoard,
  withdrawChallenge,
  hourLabel,
  dayLabel,
  trackChallenge,
  type Challenge,
} from "../../lib/challenges";

/**
 * The board.
 *
 * Two lists, deliberately separate: what everyone can take, and what you
 * are already in. A captain checking whether anybody bit should not have
 * to hunt for their own post among strangers'.
 */
export function ChallengeBoardScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AccountStackParamList>>();
  const qc = useQueryClient();
  const [sport, setSport] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["challenges", sport],
    queryFn: () => fetchChallengeBoard(sport ?? undefined),
  });

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["challenges"] });
  }, [qc]);

  const sports = q.data?.limits.sports?.length
    ? q.data.limits.sports
    : ["CRICKET", "FOOTBALL", "PICKLEBALL"];

  const mineLive = useMemo(
    () =>
      (q.data?.mine ?? []).filter((c) =>
        ["OPEN", "COUNTERED", "AGREED", "PART_PAID"].includes(c.status),
      ),
    [q.data?.mine],
  );

  if (q.data && !q.data.enabled) {
    return (
      <Screen>
        <View style={{ padding: 24, alignItems: "center", gap: 10 }}>
          <Swords size={28} color={colors.zinc600} />
          <Text variant="heading" color={colors.foreground}>
            Challenges aren&apos;t open yet
          </Text>
          <Text variant="small" color={colors.zinc500} style={{ textAlign: "center" }}>
            The arena will switch this on soon. You&apos;ll be able to post a match
            and let another team take it.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 14 }}
        refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={refresh} />}
      >
        <View style={{ gap: 4 }}>
          <Text variant="title" color={colors.foreground}>
            {q.data?.copy.title || "Challenge a team"}
          </Text>
          <Text variant="small" color={colors.zinc500}>
            {q.data?.copy.subtitle ||
              "Got a side but no opposition? Put up a match and let another captain take it."}
          </Text>
        </View>

        <Button
          label="Post a challenge"
          variant="primary"
          leadingIcon={<Plus size={16} color="#000" />}
          onPress={() => {
            trackChallenge("POST_OPENED");
            nav.navigate("PostChallenge");
          }}
        />

        {/* Sport filter. Only shown when the venue runs more than one. */}
        {sports.length > 1 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {[null, ...sports].map((sp) => {
              const on = sport === sp;
              return (
                <Pressable
                  key={sp ?? "all"}
                  onPress={() => setSport(sp)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: on ? colors.emerald400 : colors.zinc800,
                    backgroundColor: on ? colors.emerald500_10 : "transparent",
                  }}
                >
                  <Text variant="tiny" color={on ? colors.emerald400 : colors.zinc400}>
                    {sp ? sp[0] + sp.slice(1).toLowerCase() : "All"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {mineLive.length > 0 && (
          <View style={{ gap: 8 }}>
            <Text variant="tiny" color={colors.zinc500}>
              YOURS
            </Text>
            {mineLive.map((c) => (
              <ChallengeCard
                key={c.id}
                c={c}
                viewerId={q.data?.viewerId ?? ""}
                onPress={() => nav.navigate("ChallengeDetail", { id: c.id })}
                onWithdraw={() => {
                  Alert.alert("Withdraw this challenge?", "It comes off the board.", [
                    { text: "Keep it", style: "cancel" },
                    {
                      text: "Withdraw",
                      style: "destructive",
                      onPress: async () => {
                        const res = await withdrawChallenge(c.id);
                        if (res.error) Alert.alert("Can't withdraw", res.error);
                        refresh();
                      },
                    },
                  ]);
                }}
              />
            ))}
          </View>
        )}

        <View style={{ gap: 8 }}>
          <Text variant="tiny" color={colors.zinc500}>
            OPEN CHALLENGES
          </Text>
          {(q.data?.board ?? []).filter((c) => c.createdByUserId !== q.data?.viewerId).length ===
          0 ? (
            <View
              style={{
                padding: 20,
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: colors.zinc800,
                alignItems: "center",
              }}
            >
              <Text variant="small" color={colors.zinc500} style={{ textAlign: "center" }}>
                {q.data?.copy.empty ||
                  "Nobody has put up a match yet. Post one and it'll show up for every other player."}
              </Text>
            </View>
          ) : (
            (q.data?.board ?? [])
              .filter((c) => c.createdByUserId !== q.data?.viewerId)
              .map((c) => (
                <ChallengeCard
                  key={c.id}
                  c={c}
                  viewerId={q.data?.viewerId ?? ""}
                  onPress={() => nav.navigate("ChallengeDetail", { id: c.id })}
                />
              ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

function ChallengeCard({
  c,
  viewerId,
  onPress,
  onWithdraw,
}: {
  c: Challenge;
  viewerId: string;
  onPress: () => void;
  onWithdraw?: () => void;
}) {
  const mine = c.createdByUserId === viewerId;
  const live = c.windows.filter((w) => w.status === "OFFERED" || w.status === "ACCEPTED");
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: c.status === "AGREED" ? colors.emerald400 : colors.zinc800,
        backgroundColor: colors.card,
        padding: 14,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" color={colors.foreground}>
            {c.teamName || c.createdBy?.name || "A team"}
          </Text>
          <Text variant="tiny" color={colors.zinc500}>
            {c.sport[0] + c.sport.slice(1).toLowerCase()} · {c.playerCount} players
            {c.status === "COUNTERED" ? " · counter-offered" : ""}
            {c.status === "AGREED" ? " · matched" : ""}
          </Text>
        </View>
        <ChevronRight size={18} color={colors.zinc600} />
      </View>

      {c.notes ? (
        <Text variant="small" color={colors.zinc400}>
          {c.notes}
        </Text>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {live.slice(0, 3).map((w) => (
          <View
            key={w.id}
            style={{
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: radius.sm,
              borderWidth: 1,
              borderColor: w.status === "ACCEPTED" ? colors.emerald400 : colors.zinc800,
            }}
          >
            <Text
              variant="tiny"
              color={w.status === "ACCEPTED" ? colors.emerald400 : colors.zinc400}
            >
              {dayLabel(w.date)} · {hourLabel(w.startHour)}–{hourLabel(w.endHour)}
            </Text>
          </View>
        ))}
      </View>

      {mine && onWithdraw && c.status !== "AGREED" ? (
        <Pressable onPress={onWithdraw} hitSlop={8}>
          <Text variant="tiny" color={colors.zinc500}>
            Withdraw
          </Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}
