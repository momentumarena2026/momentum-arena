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
  statusLabel,
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
        // CONFIRMED belongs here. It used to drop out of every list the moment
        // both halves landed — which is exactly when the poster earns their
        // spin, so the prize had no route in at all.
        // SLOT_LOST belongs here too, for as long as money is owed on it. A
        // captain whose hour was sold, and who is owed a refund the arena
        // makes by hand, had no route back to the challenge at all except the
        // notification — so the one place that states what they are owed was
        // unreachable the moment the push scrolled away.
        ["OPEN", "COUNTERED", "AGREED", "PART_PAID", "CONFIRMED", "SLOT_LOST"].includes(
          c.status,
        ),
      ),
    [q.data?.mine],
  );

  // A switched-off board must not hide somebody's OWN live matches. A
  // captain holding a part-paid match with money in and a court held was
  // told the feature did not exist yet, and lost the only route to the
  // screen where he could pay the rest. The wall is for people with nothing
  // in flight.
  const boardOff = !!q.data && !q.data.enabled;
  if (boardOff && mineLive.length === 0) {
    return (
      <Screen>
        <View style={{ padding: 24, alignItems: "center", gap: 10 }}>
          <Swords size={28} color={colors.zinc600} />
          <Text variant="heading" color={colors.foreground}>
            Challenges aren&apos;t open right now
          </Text>
          <Text variant="small" color={colors.zinc500} style={{ textAlign: "center" }}>
            The arena has paused this. You&apos;ll be able to post a match and let
            another team take it when it&apos;s back.
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
          <Text variant="title" color={colors.foreground} numberOfLines={2}>
            {/* Clamped: the venue's title is stored up to 200 characters, and a
                long one pushed the whole board off the screen. */}
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

        {boardOff && (
          <View
            style={{
              borderWidth: 1,
              borderColor: colors.zinc800,
              borderRadius: radius.md,
              padding: 12,
            }}
          >
            <Text variant="small" color={colors.zinc400}>
              The arena has paused new challenges. Your matches below are unaffected —
              finish paying and play them as normal.
            </Text>
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
                // The "· prize inside" hint is gated on this, and it was only
                // ever passed to the OPEN-board cards — which exclude your own
                // challenges by construction, so the one nudge toward the
                // wheel could never appear to the person who earned it.
                spinEnabled={q.data?.spinEnabled ?? false}
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
          {(q.data?.board ?? []).length ===
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
                {/* "Nobody has put up a match yet" directly beneath the match
                    you just posted reads as your post having failed. Your own
                    challenge is listed above, in its own section; this section
                    is about everybody ELSE, so say that when you have one. */}
                {/* Counting `mine` counted DEAD ones too, so a captain whose
                    only challenge had lost its hour was told "Yours is up". */}
                {mineLive.some((c) =>
                  ["OPEN", "COUNTERED", "AGREED", "PART_PAID"].includes(c.status),
                )
                  ? "No other teams have put up a match yet. Yours is up — we'll tell you the moment somebody takes it."
                  : q.data?.copy.empty ||
                    "Nobody has put up a match yet. Post one and it'll show up for every other player."}
              </Text>
            </View>
          ) : (
            (q.data?.board ?? [])
              .map((c) => (
                <ChallengeCard
                  key={c.id}
                  c={c}
                  viewerId={q.data?.viewerId ?? ""}
                  spinEnabled={!!q.data?.spinEnabled}
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
  spinEnabled,
  onPress,
  onWithdraw,
}: {
  c: Challenge;
  viewerId: string;
  spinEnabled?: boolean;
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
            {/* Every live state is named. PART_PAID used to render
                identically to an unanswered post, so a captain with money
                already in and a half outstanding saw nothing about it. */}
            {c.status === "OPEN" ? "" : ` · ${statusLabel(c.status)}`}
            {c.status === "CONFIRMED" && mine && spinEnabled && !c.spin ? " · prize inside" : ""}
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

      {/* AGREED with no money in it IS withdrawable now — hiding the
          control here left the user-visible half of that lockout in place,
          with only the API able to unstick it. PART_PAID and CONFIRMED stay
          hidden: those are the venue's to unwind. */}
      {mine &&
      onWithdraw &&
      !["PART_PAID", "CONFIRMED", "EXPIRED", "WITHDRAWN"].includes(c.status) ? (
        <Pressable onPress={onWithdraw} hitSlop={8}>
          <Text variant="tiny" color={colors.zinc500}>
            Withdraw
          </Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}
