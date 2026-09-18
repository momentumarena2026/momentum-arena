import { useState } from "react";
import { View, ScrollView, Pressable, Alert, RefreshControl } from "react-native";
import { useRoute, useNavigation, type RouteProp } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { colors, radius } from "../../theme";
import type { AccountStackParamList } from "../../navigation/types";
import {
  fetchChallenge,
  acceptChallenge,
  counterChallenge,
  withdrawChallenge,
  hourLabel,
  dayLabel,
  trackChallenge,
} from "../../lib/challenges";

/**
 * One challenge, and what you can do about it.
 *
 * The server decides what is allowed and says why in a sentence; this
 * screen shows that sentence rather than working the rules out again. Two
 * surfaces answering the same question separately is how the cricket
 * engines drifted, and there is no reason to repeat it here.
 */
export function ChallengeDetailScreen() {
  const route = useRoute<RouteProp<AccountStackParamList, "ChallengeDetail">>();
  const nav = useNavigation();
  const qc = useQueryClient();
  const id = route.params.id;
  const [busy, setBusy] = useState(false);
  const [showCounter, setShowCounter] = useState(false);

  // The next seven days — as far ahead as anyone arranges a pickup game.
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i + 1);
    return d.toISOString().slice(0, 10);
  });
  const hours = Array.from({ length: 20 }, (_, i) => i + 5); // 5am–1am
  const [day, setDay] = useState<string>(days[0]);
  const [hour, setHour] = useState<number>(18);
  const [len, setLen] = useState<number>(2);

  const chip = (on: boolean) => ({
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: on ? colors.emerald400 : colors.zinc800,
    backgroundColor: on ? colors.emerald500_10 : "transparent",
  });

  const q = useQuery({ queryKey: ["challenge", id], queryFn: () => fetchChallenge(id) });
  const c = q.data?.challenge;
  const me = q.data?.viewerId;

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["challenge", id] });
    await qc.invalidateQueries({ queryKey: ["challenges"] });
  };

  if (!c) {
    return (
      <Screen>
        <View style={{ padding: 24 }}>
          <Text variant="small" color={colors.zinc500}>
            {q.isLoading ? "Loading…" : "That challenge is gone."}
          </Text>
        </View>
      </Screen>
    );
  }

  const mine = c.createdByUserId === me;
  const iAmIn = mine || c.acceptedByUserId === me;
  const live = ["OPEN", "COUNTERED"].includes(c.status);
  // Only a time the OTHER side put up can be accepted — accepting your own
  // suggestion is just waiting for an answer.
  const mySide = mine ? "CHALLENGER" : "ACCEPTOR";
  const takeable = c.windows.filter(
    (w) => w.status === "OFFERED" && (!iAmIn || w.proposedBy !== mySide),
  );

  const act = async (fn: () => Promise<{ ok?: boolean; error?: string }>) => {
    setBusy(true);
    const res = await fn().catch(() => ({ error: "Couldn't reach the arena." }));
    setBusy(false);
    if (res.error) {
      Alert.alert("Can't do that", res.error);
      return;
    }
    await refresh();
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 16 }}
        refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={refresh} />}
      >
        <View style={{ gap: 4 }}>
          <Text variant="title" color={colors.foreground}>
            {c.teamName || c.createdBy?.name || "A team"}
          </Text>
          <Text variant="small" color={colors.zinc500}>
            {c.sport[0] + c.sport.slice(1).toLowerCase()} · {c.playerCount} players ·{" "}
            {c.status.replace("_", " ").toLowerCase()}
          </Text>
          {c.notes ? (
            <Text variant="small" color={colors.zinc400} style={{ marginTop: 4 }}>
              {c.notes}
            </Text>
          ) : null}
        </View>

        {c.status === "AGREED" && (
          <View
            style={{
              borderWidth: 1,
              borderColor: colors.emerald400,
              backgroundColor: colors.emerald500_10,
              borderRadius: radius.md,
              padding: 14,
              gap: 4,
            }}
          >
            <Text variant="bodyStrong" color={colors.emerald400}>
              Match agreed
            </Text>
            <Text variant="small" color={colors.zinc300}>
              Both sides pay their half to lock the court. The arena will be in touch
              — payment is coming to the app shortly.
            </Text>
          </View>
        )}

        <View style={{ gap: 8 }}>
          <Text variant="tiny" color={colors.zinc500}>
            TIMES ON THE TABLE
          </Text>
          {c.windows
            .filter((w) => w.status !== "SUPERSEDED")
            .map((w) => {
              const isAccepted = w.status === "ACCEPTED";
              const declined = w.status === "DECLINED";
              const canTake = live && takeable.some((t) => t.id === w.id);
              return (
                <View
                  key={w.id}
                  style={{
                    borderWidth: 1,
                    borderColor: isAccepted ? colors.emerald400 : colors.zinc800,
                    borderRadius: radius.md,
                    padding: 12,
                    gap: 8,
                    opacity: declined ? 0.45 : 1,
                  }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text
                      variant="body"
                      color={isAccepted ? colors.emerald400 : colors.foreground}
                    >
                      {dayLabel(w.date)} · {hourLabel(w.startHour)}–{hourLabel(w.endHour)}
                    </Text>
                    <Text variant="tiny" color={colors.zinc600}>
                      {w.proposedBy === "CHALLENGER" ? "their time" : "counter-offer"}
                    </Text>
                  </View>
                  {canTake && (
                    <Button
                      label={mine ? "Accept this time" : "Take this match"}
                      variant="primary"
                      size="sm"
                      loading={busy}
                      onPress={() => {
                        trackChallenge("ACCEPT_TAPPED", { challengeId: c.id });
                        void act(() => acceptChallenge(c.id, w.id));
                      }}
                    />
                  )}
                </View>
              );
            })}
        </View>

        {/* Counter-offer. Open to whichever side the ball is with — a
            stranger countering an open challenge becomes its acceptor by
            doing so, and the poster answers a counter with one of their
            own. The server enforces the cap and says so if it is spent. */}
        {live && (
          <View style={{ gap: 8 }}>
            {!showCounter ? (
              <>
                <Text variant="tiny" color={colors.zinc600}>
                  None of those work? Suggest one of your own — one counter-offer each.
                </Text>
                <Button
                  label="Suggest a different time"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => {
                    trackChallenge("COUNTER_OPENED", { challengeId: c.id });
                    setShowCounter(true);
                  }}
                />
              </>
            ) : (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: colors.zinc800,
                  borderRadius: radius.md,
                  padding: 12,
                  gap: 10,
                }}
              >
                <Text variant="tiny" color={colors.zinc500}>
                  YOUR SUGGESTION
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {days.map((d) => (
                      <Pressable key={d} onPress={() => setDay(d)} style={chip(day === d)}>
                        <Text variant="tiny" color={day === d ? colors.emerald400 : colors.zinc400}>
                          {new Date(d).toLocaleDateString("en-IN", {
                            weekday: "short",
                            day: "numeric",
                          })}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {hours.map((h) => (
                      <Pressable key={h} onPress={() => setHour(h)} style={chip(hour === h)}>
                        <Text variant="tiny" color={hour === h ? colors.emerald400 : colors.zinc400}>
                          {hourLabel(h)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
                <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                  <Text variant="tiny" color={colors.zinc500}>
                    for
                  </Text>
                  {[1, 2, 3].map((n) => (
                    <Pressable key={n} onPress={() => setLen(n)} style={chip(len === n)}>
                      <Text variant="tiny" color={len === n ? colors.emerald400 : colors.zinc400}>
                        {n}h
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button
                    label="Cancel"
                    variant="secondary"
                    size="sm"
                    onPress={() => setShowCounter(false)}
                    style={{ flex: 1 }}
                  />
                  <Button
                    label="Send suggestion"
                    variant="primary"
                    size="sm"
                    loading={busy}
                    style={{ flex: 1 }}
                    onPress={async () => {
                      await act(() =>
                        counterChallenge(c.id, {
                          date: day,
                          startHour: hour,
                          endHour: hour + len,
                        }),
                      );
                      setShowCounter(false);
                    }}
                  />
                </View>
              </View>
            )}
          </View>
        )}

        {mine && live && (
          <Pressable
            onPress={() =>
              Alert.alert("Withdraw this challenge?", "It comes off the board.", [
                { text: "Keep it", style: "cancel" },
                {
                  text: "Withdraw",
                  style: "destructive",
                  onPress: async () => {
                    await act(() => withdrawChallenge(c.id));
                    nav.goBack();
                  },
                },
              ])
            }
            hitSlop={8}
          >
            <Text variant="small" color={colors.zinc500} style={{ textAlign: "center" }}>
              Withdraw this challenge
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </Screen>
  );
}
