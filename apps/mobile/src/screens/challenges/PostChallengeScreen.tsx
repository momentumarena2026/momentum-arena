import { useState } from "react";
import {
  View,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { colors, radius } from "../../theme";
import {
  fetchChallengeBoard,
  postChallenge,
  hourLabel,
  type ProposedWindow,
  challengeErrorMessage,
} from "../../lib/challenges";

/**
 * Posting a challenge.
 *
 * The times are the substance. A captain who offers one slot mostly gets
 * nobody, so the form nudges toward several — and the venue sets how many
 * are allowed, because the right number is not known yet.
 */
export function PostChallengeScreen() {
  const nav = useNavigation();
  const qc = useQueryClient();
  const board = useQuery({ queryKey: ["challenges", null], queryFn: () => fetchChallengeBoard() });

  const sports = board.data?.limits.sports?.length
    ? board.data.limits.sports
    : ["CRICKET", "FOOTBALL", "PICKLEBALL"];
  const maxWindows = board.data?.limits.maxWindows ?? 3;

  const [sport, setSport] = useState<string>(sports[0] ?? "CRICKET");
  const [teamName, setTeamName] = useState("");
  const [players, setPlayers] = useState("");
  const [notes, setNotes] = useState("");
  const [windows, setWindows] = useState<ProposedWindow[]>([]);
  const [busy, setBusy] = useState(false);

  // A disabled button that doesn't say why reads as a broken button. Name the
  // one thing that is missing, in the order the form asks for it.
  const missing = !players.trim()
    ? "Tell us how many players you have."
    : windows.length === 0
      ? "Add at least one time you can play."
      : null;

  // The next seven days, which is as far ahead as anyone plans a pickup game.
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i + 1);
    return d.toISOString().slice(0, 10);
  });
  const hours = Array.from({ length: 20 }, (_, i) => i + 5); // 5am–1am

  const [pickDay, setPickDay] = useState<string>(days[0]);
  const [pickHour, setPickHour] = useState<number>(18);
  const [pickLen, setPickLen] = useState<number>(2);

  const addWindow = () => {
    if (windows.length >= maxWindows) {
      Alert.alert("That's enough times", `You can offer up to ${maxWindows}.`);
      return;
    }
    const w: ProposedWindow = {
      date: pickDay,
      startHour: pickHour,
      endHour: pickHour + pickLen,
    };
    if (windows.some((x) => x.date === w.date && x.startHour === w.startHour)) {
      Alert.alert("Already offered", "You've put that time up already.");
      return;
    }
    setWindows([...windows, w]);
  };

  const submit = async () => {
    setBusy(true);
    const res = await postChallenge({
      sport,
      teamName: teamName.trim() || null,
      playerCount: parseInt(players.replace(/[^\d]/g, ""), 10) || 0,
      notes: notes.trim() || null,
      windows,
    }).catch((e) => ({ error: challengeErrorMessage(e) }));
    setBusy(false);
    if (res.error) {
      Alert.alert("Can't post that", res.error);
      return;
    }
    await qc.invalidateQueries({ queryKey: ["challenges"] });
    nav.goBack();
  };

  const chip = (on: boolean) => ({
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: on ? colors.emerald400 : colors.zinc800,
    backgroundColor: on ? colors.emerald500_10 : "transparent",
  });
  const input = {
    borderWidth: 1,
    borderColor: colors.zinc800,
    borderRadius: radius.md,
    padding: 12,
    color: colors.foreground,
    backgroundColor: colors.inputBackground,
  };

  return (
    <Screen padded={false}>
      {/* The submit button sits at the bottom of a long form, so on a real
          device it is behind the keyboard the whole time somebody is
          filling it in — and behind the tab bar even when they are not.
          The avoiding view lifts it clear of the keyboard; the padding
          clears the tab bar. Both are needed: neither alone is enough. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 18 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
        <View style={{ gap: 4 }}>
          <Text variant="title" color={colors.foreground}>
            Post a challenge
          </Text>
          <Text variant="small" color={colors.zinc500}>
            Every player on the app can see this and take you on.
          </Text>
        </View>

        {sports.length > 1 && (
          <View style={{ gap: 8 }}>
            <Text variant="tiny" color={colors.zinc500}>
              SPORT
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {sports.map((sp) => (
                <Pressable key={sp} onPress={() => setSport(sp)} style={chip(sport === sp)}>
                  <Text variant="small" color={sport === sp ? colors.emerald400 : colors.zinc400}>
                    {sp[0] + sp.slice(1).toLowerCase()}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <View style={{ gap: 8 }}>
          <Text variant="tiny" color={colors.zinc500}>
            YOUR SIDE
          </Text>
          <TextInput
            style={input as never}
            placeholder="Team name (optional)"
            placeholderTextColor={colors.zinc600}
            value={teamName}
            onChangeText={setTeamName}
          />
          <TextInput
            style={input as never}
            placeholder="How many players do you have?"
            placeholderTextColor={colors.zinc600}
            keyboardType="numeric"
            value={players}
            onChangeText={setPlayers}
          />
          <Text variant="tiny" color={colors.zinc600}>
            Tells the other captain what they&apos;re walking into, and how many to bring.
          </Text>
        </View>

        <View style={{ gap: 8 }}>
          <Text variant="tiny" color={colors.zinc500}>
            WHEN CAN YOU PLAY? ({windows.length}/{maxWindows})
          </Text>
          <Text variant="tiny" color={colors.zinc600}>
            Offer more than one. A challenge with a single time usually goes unanswered.
          </Text>

          {windows.map((w, i) => (
            <View
              key={`${w.date}-${w.startHour}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                borderWidth: 1,
                borderColor: colors.emerald400,
                borderRadius: radius.md,
                padding: 10,
              }}
            >
              <Text variant="small" color={colors.emerald400}>
                {new Date(w.date).toLocaleDateString("en-IN", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}{" "}
                · {hourLabel(w.startHour)}–{hourLabel(w.endHour)}
              </Text>
              <Pressable onPress={() => setWindows(windows.filter((_, x) => x !== i))} hitSlop={8}>
                <X size={16} color={colors.zinc500} />
              </Pressable>
            </View>
          ))}

          {windows.length < maxWindows && (
            <View
              style={{
                borderWidth: 1,
                borderColor: colors.zinc800,
                borderRadius: radius.md,
                padding: 12,
                gap: 10,
              }}
            >
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {days.map((d) => (
                    <Pressable key={d} onPress={() => setPickDay(d)} style={chip(pickDay === d)}>
                      <Text
                        variant="tiny"
                        color={pickDay === d ? colors.emerald400 : colors.zinc400}
                      >
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
                    <Pressable key={h} onPress={() => setPickHour(h)} style={chip(pickHour === h)}>
                      <Text
                        variant="tiny"
                        color={pickHour === h ? colors.emerald400 : colors.zinc400}
                      >
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
                  <Pressable key={n} onPress={() => setPickLen(n)} style={chip(pickLen === n)}>
                    <Text variant="tiny" color={pickLen === n ? colors.emerald400 : colors.zinc400}>
                      {n}h
                    </Text>
                  </Pressable>
                ))}
                <View style={{ flex: 1 }} />
                <Pressable
                  onPress={addWindow}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: colors.emerald400,
                  }}
                >
                  <Plus size={14} color={colors.emerald400} />
                  <Text variant="tiny" color={colors.emerald400}>
                    Add time
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>

        <View style={{ gap: 8 }}>
          <Text variant="tiny" color={colors.zinc500}>
            ANYTHING ELSE
          </Text>
          <TextInput
            style={[input as never, { minHeight: 70, textAlignVertical: "top" }]}
            placeholder="e.g. friendly game, we're mostly beginners"
            placeholderTextColor={colors.zinc600}
            multiline
            value={notes}
            onChangeText={setNotes}
          />
        </View>

        <Button
          label="Put it on the board"
          variant="primary"
          loading={busy}
          disabled={busy || windows.length === 0 || !players.trim()}
          onPress={submit}
        />
        <Text
          variant="tiny"
          color={missing ? colors.zinc500 : colors.zinc600}
          style={{ textAlign: "center" }}
        >
          {missing ?? "Nothing is charged yet. Whoever pays their half first blocks the court."}
        </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
