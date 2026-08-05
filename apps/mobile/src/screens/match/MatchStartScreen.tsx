import { useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Radio, Swords } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { colors, radius, spacing } from "../../theme";
import {
  createMatch,
  fetchMyMatches,
  overs,
  type MatchSport,
} from "../../lib/public-match";
import type { AccountStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<AccountStackParamList>;

const SPORTS: MatchSport[] = ["CRICKET", "FOOTBALL", "PICKLEBALL"];

/**
 * Start or rejoin a scratch match. Mirrors /match on the web — three
 * fields and a button, because this gets used standing on the turf with
 * one hand.
 */
export function MatchStartScreen() {
  const navigation = useNavigation<Nav>();
  const [sport, setSport] = useState<MatchSport>("CRICKET");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [oversInput, setOvers] = useState("6");
  const [joinCode, setJoinCode] = useState("");

  const mine = useQuery({ queryKey: ["my-matches"], queryFn: fetchMyMatches });

  const create = useMutation({
    mutationFn: () =>
      createMatch({
        sport,
        teamAName: a.trim(),
        teamBName: b.trim(),
        oversPerInnings: sport === "CRICKET" ? Number(oversInput) || null : null,
      }),
    onSuccess: (res) => {
      if (res.error || !res.code) {
        Alert.alert("Couldn't start", res.error ?? "Try again.");
        return;
      }
      setA("");
      setB("");
      navigation.navigate("MatchScore", { code: res.code });
    },
    onError: (e) =>
      Alert.alert("Couldn't start", e instanceof Error ? e.message : "Try again."),
  });

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={mine.isRefetching}
            onRefresh={() => void mine.refetch()}
            tintColor={colors.emerald400}
          />
        }
      >
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Swords size={20} color={colors.emerald400} />
            <Text variant="title" color={colors.foreground}>
              Score a match
            </Text>
          </View>
          <Text variant="small" color={colors.zinc400}>
            Playing a casual game? Start a scoreboard and share the code —
            anyone can follow along live.
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.sportRow}>
            {SPORTS.map((s) => {
              const on = sport === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => setSport(s)}
                  style={[styles.sportChip, on && styles.sportChipOn]}
                >
                  <Text
                    variant="small"
                    weight={on ? "700" : "500"}
                    color={on ? colors.emerald400 : colors.zinc400}
                  >
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            style={styles.input}
            placeholder="Team A"
            placeholderTextColor={colors.zinc600}
            value={a}
            onChangeText={setA}
          />
          <TextInput
            style={styles.input}
            placeholder="Team B"
            placeholderTextColor={colors.zinc600}
            value={b}
            onChangeText={setB}
          />
          {sport === "CRICKET" && (
            <TextInput
              style={styles.input}
              placeholder="Overs per innings"
              placeholderTextColor={colors.zinc600}
              keyboardType="numeric"
              value={oversInput}
              onChangeText={setOvers}
            />
          )}
          <Button
            label="Start scoring"
            variant="primary"
            loading={create.isPending}
            disabled={create.isPending || !a.trim() || !b.trim()}
            onPress={() => create.mutate()}
          />
        </View>

        <View style={styles.card}>
          <Text variant="bodyStrong" color={colors.foreground}>
            Follow a match
          </Text>
          <View style={styles.joinRow}>
            <TextInput
              style={[styles.input, styles.joinInput]}
              placeholder="Match code"
              placeholderTextColor={colors.zinc600}
              autoCapitalize="characters"
              value={joinCode}
              onChangeText={setJoinCode}
            />
            <Button
              label="Open"
              size="sm"
              variant="secondary"
              disabled={!joinCode.trim()}
              onPress={() =>
                navigation.navigate("MatchScore", {
                  code: joinCode.trim().toUpperCase(),
                })
              }
            />
          </View>
        </View>

        {(mine.data ?? []).length > 0 && (
          <View style={styles.recent}>
            <Text variant="small" color={colors.zinc500}>
              YOUR MATCHES
            </Text>
            {(mine.data ?? []).map((m) => (
              <Pressable
                key={m.code}
                onPress={() => navigation.navigate("MatchScore", { code: m.code })}
                style={styles.recentRow}
              >
                <View style={styles.recentText}>
                  <Text variant="small" color={colors.foreground}>
                    {m.teamAName} v {m.teamBName}
                  </Text>
                  <Text variant="tiny" color={colors.zinc500}>
                    {m.sport} ·{" "}
                    {m.sport === "CRICKET"
                      ? `${m.state.runsA}/${m.state.wicketsA} (${overs(m.state.ballsA)})`
                      : `${m.state.runsA}–${m.state.runsB}`}
                  </Text>
                </View>
                {m.status === "LIVE" ? (
                  <View style={styles.liveTag}>
                    <Radio size={11} color={colors.emerald400} />
                    <Text variant="tiny" weight="700" color={colors.emerald400}>
                      LIVE
                    </Text>
                  </View>
                ) : (
                  <Text variant="tiny" color={colors.zinc600}>
                    {m.status}
                  </Text>
                )}
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing["5"],
    gap: spacing["4"],
    paddingBottom: spacing["10"],
  },
  header: { gap: spacing["1"] },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  card: {
    gap: spacing["3"],
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["4"],
  },
  sportRow: { flexDirection: "row", gap: spacing["2"] },
  sportChip: {
    flex: 1,
    alignItems: "center",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc700,
    paddingVertical: spacing["2"],
  },
  sportChipOn: {
    borderColor: "rgba(16,185,129,0.5)",
    backgroundColor: "rgba(16,185,129,0.10)",
  },
  input: {
    height: 44,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: colors.zinc900,
    paddingHorizontal: spacing["3"],
    color: colors.foreground,
    fontSize: 14,
  },
  joinRow: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  joinInput: { flex: 1 },
  recent: { gap: spacing["2"] },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["3"],
  },
  recentText: { flex: 1, gap: 2 },
  liveTag: { flexDirection: "row", alignItems: "center", gap: 4 },
});
