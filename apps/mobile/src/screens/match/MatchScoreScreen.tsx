import { useEffect } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, Radio, Share2, Undo2 } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  fetchMatch,
  scoreMatch,
  undoMatch,
  finishMatch,
  overs,
  type ScoreEvent,
} from "../../lib/public-match";
import type { AccountStackParamList } from "../../navigation/types";

/**
 * The scoreboard. Same screen for the scorer and for spectators —
 * `canScore` comes from the server and decides whether the pad renders,
 * so a shared code is safe to hand around.
 *
 * Spectators poll; the scorer doesn't, because their own taps are the
 * source of truth and refetching under their thumb would fight the
 * optimistic update.
 */
export function MatchScoreScreen() {
  const route = useRoute<RouteProp<AccountStackParamList, "MatchScore">>();
  const code = route.params.code;
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["match", code],
    queryFn: () => fetchMatch(code),
  });
  const match = q.data;

  useEffect(() => {
    if (!match || match.canScore || match.status !== "LIVE") return;
    const id = setInterval(() => void q.refetch(), 8000);
    return () => clearInterval(id);
  }, [match, q]);

  const apply = useMutation({
    mutationFn: async (e: ScoreEvent | "UNDO" | "FINISH") => {
      if (e === "UNDO") return undoMatch(code);
      if (e === "FINISH") return finishMatch(code);
      return scoreMatch(code, e);
    },
    onSuccess: (res) => {
      if ((res as { error?: string }).error) {
        Alert.alert("Couldn't update", (res as { error?: string }).error!);
      }
      void qc.invalidateQueries({ queryKey: ["match", code] });
      void qc.invalidateQueries({ queryKey: ["my-matches"] });
    },
    onError: (e) =>
      Alert.alert("Couldn't update", e instanceof Error ? e.message : "Try again."),
  });

  if (q.isLoading || !match) {
    return (
      <Screen>
        <Skeleton height={140} rounded="xl" />
      </Screen>
    );
  }

  const s = match.state;
  const cricket = match.sport === "CRICKET";
  const batA = s.innings === 0;
  const done = match.status !== "LIVE";
  const busy = apply.isPending;

  const Pad = ({
    label,
    event,
    tone,
    wide,
  }: {
    label: string;
    event: ScoreEvent;
    tone?: "danger" | "muted";
    wide?: boolean;
  }) => (
    <Pressable
      onPress={() => apply.mutate(event)}
      disabled={busy || done}
      style={({ pressed }) => [
        styles.pad,
        wide && styles.padWide,
        tone === "danger" && styles.padDanger,
        tone === "muted" && styles.padMuted,
        (pressed || busy || done) && { opacity: 0.6 },
      ]}
    >
      <Text
        weight="700"
        color={tone === "danger" ? "#fca5a5" : colors.foreground}
        style={tone === "muted" ? styles.padMutedText : styles.padText}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.topRow}>
          <View style={styles.liveTag}>
            {match.status === "LIVE" ? (
              <>
                <Radio size={13} color={colors.emerald400} />
                <Text variant="tiny" weight="700" color={colors.emerald400}>
                  LIVE
                </Text>
              </>
            ) : (
              <Text variant="tiny" weight="700" color={colors.zinc500}>
                {match.status}
              </Text>
            )}
          </View>
          <Pressable
            onPress={() => {
              // The system share sheet rather than a clipboard dependency:
              // people send this to a group chat, not paste it somewhere.
              void Share.share({
                message: `Follow ${match.teamAName} v ${match.teamBName} live — match code ${match.code}`,
              }).catch(() => {});
            }}
            style={styles.codeBtn}
          >
            <Share2 size={13} color={colors.zinc300} />
            <Text variant="small" color={colors.zinc300}>
              {match.code}
            </Text>
          </Pressable>
        </View>

        <View style={styles.board}>
          {[
            { name: match.teamAName, runs: s.runsA, wkts: s.wicketsA, balls: s.ballsA, striking: cricket && batA },
            { name: match.teamBName, runs: s.runsB, wkts: s.wicketsB, balls: s.ballsB, striking: cricket && !batA },
          ].map((t) => (
            <View key={t.name} style={[styles.boardRow, !t.striking && { opacity: 0.7 }]}>
              <View style={styles.boardName}>
                <Text variant="body" color={colors.foreground} numberOfLines={1}>
                  {t.name}
                </Text>
                {t.striking && (
                  <Text variant="tiny" weight="700" color={colors.emerald400}>
                    BATTING
                  </Text>
                )}
              </View>
              <Text weight="800" color={colors.foreground} style={styles.score}>
                {cricket ? `${t.runs}/${t.wkts}` : t.runs}
                {cricket && (
                  <Text variant="small" color={colors.zinc500}>
                    {"  "}({overs(t.balls)}
                    {match.oversPerInnings ? `/${match.oversPerInnings}` : ""})
                  </Text>
                )}
              </Text>
            </View>
          ))}
        </View>

        {!match.canScore ? (
          <Text variant="small" color={colors.zinc500} style={styles.note}>
            Watching live — the scorer updates this from their phone.
          </Text>
        ) : done ? (
          <Text variant="small" color={colors.zinc500} style={styles.note}>
            This match has finished.
          </Text>
        ) : (
          <>
            <View style={styles.grid}>
              {cricket ? (
                <>
                  {[0, 1, 2, 3, 4, 6].map((n) => (
                    <Pad key={n} label={String(n)} event={{ t: "RUN", runs: n }} />
                  ))}
                  <Pad label="Wd" event={{ t: "WIDE" }} />
                  <Pad label="Nb" event={{ t: "NO_BALL" }} />
                  <Pad label="Wicket" event={{ t: "WICKET" }} tone="danger" wide />
                  <Pad label="End innings" event={{ t: "END_INNINGS" }} tone="muted" wide />
                </>
              ) : (
                <>
                  <Pad label={`+1 ${match.teamAName}`} event={{ t: "POINT", side: "A" }} wide />
                  <Pad label={`+1 ${match.teamBName}`} event={{ t: "POINT", side: "B" }} wide />
                </>
              )}
            </View>

            <View style={styles.footRow}>
              <Pressable
                onPress={() => apply.mutate("UNDO")}
                disabled={busy}
                style={({ pressed }) => [styles.footBtn, pressed && { opacity: 0.7 }]}
              >
                <Undo2 size={15} color={colors.zinc300} />
                <Text variant="small" color={colors.zinc300}>
                  Undo
                </Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  Alert.alert("End match?", "The scoreboard will be locked.", [
                    { text: "Cancel", style: "cancel" },
                    { text: "End match", style: "destructive", onPress: () => apply.mutate("FINISH") },
                  ])
                }
                disabled={busy}
                style={({ pressed }) => [styles.footBtn, pressed && { opacity: 0.7 }]}
              >
                <Flag size={15} color={colors.zinc300} />
                <Text variant="small" color={colors.zinc300}>
                  End match
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing["5"], gap: spacing["4"], paddingBottom: spacing["10"] },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  liveTag: { flexDirection: "row", alignItems: "center", gap: 5 },
  codeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc700,
    paddingHorizontal: spacing["3"],
    paddingVertical: 6,
  },
  board: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["4"],
  },
  boardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing["3"],
    paddingVertical: spacing["2"],
  },
  boardName: { flex: 1, gap: 2 },
  score: { fontSize: 26 },
  note: { textAlign: "center", marginTop: spacing["2"] },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing["2"] },
  pad: {
    width: "23%",
    alignItems: "center",
    justifyContent: "center",
    height: 60,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: colors.zinc900,
  },
  padWide: { width: "48.5%" },
  padDanger: {
    borderColor: "rgba(239,68,68,0.4)",
    backgroundColor: "rgba(239,68,68,0.10)",
  },
  padMuted: { backgroundColor: colors.zinc900 },
  padText: { fontSize: 18 },
  padMutedText: { fontSize: 13 },
  footRow: { flexDirection: "row", gap: spacing["2"] },
  footBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 44,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
});
