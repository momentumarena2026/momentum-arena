import { useEffect, useState } from "react";
import { getCurrentHourIST, getTodayIST, getUpcomingDatesIST } from "../../lib/ist-date";
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
  dayLabel,
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
  // The sports list arrives with the board fetch, AFTER first render — so
  // this was frozen on the hard-coded fallback. With `sports: ["FOOTBALL"]`
  // the picker hid itself (one option) and every post still sent CRICKET,
  // which the server refused, leaving the board unpostable with nothing the
  // user could do about it.
  useEffect(() => {
    if (sports.length > 0 && !sports.includes(sport)) setSport(sports[0]);
  }, [sports, sport]);
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
  //
  // Starting at tomorrow-at-the-earliest made TONIGHT unreachable — the
  // single most valuable case for a pickup-game board. At 1pm with four
  // hours' notice required, a 7pm game is legal and the server accepts it;
  // only the app refused to offer it. The rule is a number of MINUTES, so
  // the strip starts today whenever today still has a legal hour in it and
  // steps forward only for notice periods long enough to swallow a whole day.
  //
  // Built from the IST helpers, not `toISOString()` on a local Date: between
  // midnight and 05:30 IST that produced yesterday's date, while the arena is
  // open until 1am.
  const minLeadMins = board.data?.limits?.minLeadMins ?? 240;
  const openHour = board.data?.limits?.openHour ?? 5;
  const closeHour = board.data?.limits?.closeHour ?? 25;
  const earliestHourToday = getCurrentHourIST() + Math.ceil(minLeadMins / 60);
  const todayIsStillPlayable = earliestHourToday < closeHour;
  const days = getUpcomingDatesIST(8).slice(todayIsStillPlayable ? 0 : 1, 8);
  // The arena's real hours, not a hard-coded 5–25. When the venue moved its
  // closing time the chips kept offering the old range and the board refused
  // what the arena was actually selling. On TODAY the notice period also
  // rules out the next few hours, so they are not offered either.
  const allHours = Array.from(
    { length: Math.max(1, closeHour - openHour) },
    (_, i) => i + openHour,
  );

  const [pickDay, setPickDay] = useState<string>(days[0]);
  // On today, the notice period has already eaten the next few hours.
  const hours = allHours.filter(
    (h) => pickDay !== getTodayIST() || h >= earliestHourToday,
  );
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
            placeholder="Team name — or we'll use yours"
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
                {dayLabel(`${w.date}T00:00:00.000Z`)}{" "}
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
                    <Pressable
                      key={d}
                      onPress={() => {
                        setPickDay(d);
                        // Today offers fewer hours than the rest of the
                        // strip, so a selection carried over from another
                        // day can be one the arena cannot take.
                        if (d === getTodayIST() && pickHour < earliestHourToday) {
                          setPickHour(earliestHourToday);
                        }
                      }}
                      style={chip(pickDay === d)}
                    >
                      <Text
                        variant="tiny"
                        color={pickDay === d ? colors.emerald400 : colors.zinc400}
                      >
                        {d === getTodayIST()
                          ? "Today"
                          : dayLabel(`${d}T00:00:00.000Z`)}
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
