import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudOff, Flag, Radio, Share2, Undo2, Users } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  fetchMatch,
  finishMatch,
  overs,
  scoreMatchBatch,
  type ScoreEvent,
  type WicketKind,
} from "../../lib/public-match";
import {
  inningsOver,
  replay,
  validateScoreEvent,
  type MatchRules,
  type PublicMatchState,
} from "../../lib/match-engine";
import type { AccountStackParamList } from "../../navigation/types";

/**
 * The scoreboard. Same screen for the scorer and for spectators —
 * `canScore` comes from the server and decides whether the pad renders,
 * so a shared code is safe to hand around.
 *
 * Scoring is LOCAL-FIRST. A tap appends to an on-device event log, the
 * board re-renders from a local replay, and the event joins a queue that
 * flushes as one batched write a beat later. That's what makes the pad
 * feel instant and keeps a scorer working through the dead wifi patches
 * every ground has; the server replays the same log, so the two can't
 * disagree about what happened.
 *
 * Spectators poll instead — their screen has no local truth to protect.
 */

const WICKET_KINDS: Array<{ k: WicketKind; label: string }> = [
  { k: "BOWLED", label: "Bowled" },
  { k: "CAUGHT", label: "Caught" },
  { k: "LBW", label: "LBW" },
  { k: "RUN_OUT", label: "Run out" },
  { k: "STUMPED", label: "Stumped" },
  { k: "HIT_WICKET", label: "Hit wicket" },
  { k: "OTHER", label: "Other" },
];

/** How long to sit on a tap before shipping the batch. Long enough that
 *  a quick 4-then-1 goes up as one write, short enough that a spectator
 *  refreshing sees it. */
const FLUSH_MS = 700;

export function MatchScoreScreen() {
  const route = useRoute<RouteProp<AccountStackParamList, "MatchScore">>();
  const code = route.params.code;
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["match", code],
    queryFn: () => fetchMatch(code),
  });
  const match = q.data;
  const canScore = !!match?.canScore;
  const live = match?.status === "LIVE";

  // ---- Local event log (scorer only) ----
  const [log, setLog] = useState<ScoreEvent[] | null>(null);
  const queue = useRef<Array<ScoreEvent | { t: "UNDO" }>>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncFailed, setSyncFailed] = useState(false);
  // Read by push()'s validator. Refs, not deps: the callback must stay
  // stable across renders or every tap would re-create the flush timer.
  const sportRef = useRef<MatchRules["sport"]>("CRICKET");
  const oversRef = useRef<number | null>(null);

  // Seed the local log once from the server. Re-seeding on every refetch
  // would stomp taps that haven't flushed yet.
  useEffect(() => {
    if (log === null && match?.events) setLog(match.events);
  }, [match?.events, log]);

  const flush = useCallback(async () => {
    timer.current = null;
    const batch = queue.current;
    if (batch.length === 0) return;
    queue.current = [];
    setPendingCount(0);
    try {
      const res = await scoreMatchBatch(code, batch);
      if (res.error) {
        setSyncFailed(true);
        Alert.alert("Couldn't save", res.error);
        // The server rejected it, so our local log is now a lie — pull
        // the truth back rather than keep scoring on a fork.
        const fresh = await q.refetch();
        setLog(fresh.data?.events ?? []);
        return;
      }
      setSyncFailed(false);
      void qc.invalidateQueries({ queryKey: ["my-matches"] });
    } catch {
      // Offline or a flaky ground connection: keep the events and try
      // again on the next tap, or when the scorer taps Retry.
      queue.current = [...batch, ...queue.current];
      setPendingCount(queue.current.length);
      setSyncFailed(true);
    }
  }, [code, qc, q]);

  // Flush anything still queued when the scorer leaves the screen.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (queue.current.length > 0) void flush();
    };
  }, [flush]);

  const schedule = useCallback(() => {
    setPendingCount(queue.current.length);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), FLUSH_MS);
  }, [flush]);

  const push = useCallback(
    (e: ScoreEvent) => {
      setLog((prev) => {
        const log = prev ?? [];
        // Same rules the server runs, against the same log. Catching it
        // here keeps an illegal tap out of the batch entirely — otherwise
        // the server rejects the whole flush and the scorer loses the over.
        const problem = validateScoreEvent(replay(log, sportRef.current), e, {
          sport: sportRef.current,
          oversPerInnings: oversRef.current,
        });
        if (problem) {
          Alert.alert("Can't do that", problem);
          return prev;
        }
        queue.current.push(e);
        schedule();
        return [...log, e];
      });
    },
    [schedule],
  );

  const undo = useCallback(() => {
    setLog((prev) => (prev && prev.length > 0 ? prev.slice(0, -1) : prev));
    queue.current.push({ t: "UNDO" });
    schedule();
  }, [schedule]);

  // Spectators poll; the scorer never does — a refetch under their thumb
  // would fight the local log.
  useEffect(() => {
    if (!match || canScore || !live) return;
    const id = setInterval(() => void q.refetch(), 8000);
    return () => clearInterval(id);
  }, [match, canScore, live, q]);

  // ---- Sheets ----
  const [squadFor, setSquadFor] = useState<"A" | "B" | null>(null);
  const [squadText, setSquadText] = useState("");
  const [wicketOpen, setWicketOpen] = useState(false);
  const [wicketKind, setWicketKind] = useState<WicketKind>("BOWLED");
  const [pick, setPick] = useState<null | {
    title: string;
    names: string[];
    onPick: (name: string) => void;
  }>(null);

  const sport = match?.sport ?? "CRICKET";
  const cricket = sport === "CRICKET";
  sportRef.current = sport;
  oversRef.current = match?.oversPerInnings ?? null;

  // The board: replayed locally for the scorer, straight from the server
  // for everyone else.
  const s: PublicMatchState | undefined = useMemo(() => {
    if (canScore && log) return replay(log, sport);
    return match?.state;
  }, [canScore, log, sport, match?.state]);

  if (q.isLoading || !match || !s) {
    return (
      <Screen>
        <Skeleton height={140} rounded="xl" />
      </Screen>
    );
  }

  const batA = s.innings === 0;
  const done = match.status !== "LIVE";
  const battingSquad = batA ? s.squadA : s.squadB;
  const bowlingSquad = batA ? s.squadB : s.squadA;
  const scoring = canScore && !done;
  // Why the innings can't continue, if it can't: overs bowled, all out, or
  // the target passed. Drives the UI as well as the guards — the reported
  // bug was the pad staying live past the last over, and the console still
  // asking for a next bowler that could never bowl.
  const inningsDone = cricket
    ? inningsOver(s, { sport, oversPerInnings: match.oversPerInnings })
    : null;
  // Whoever is out or already at the crease can't walk in again.
  const availableBatters = battingSquad.filter(
    (n) => n !== s.striker && n !== s.nonStriker && !s.batting[n]?.out,
  );

  const openSquad = (side: "A" | "B") => {
    setSquadText((side === "A" ? s.squadA : s.squadB).join("\n"));
    setSquadFor(side);
  };

  const saveSquad = () => {
    if (!squadFor) return;
    const players = squadText
      .split(/[\n,]/)
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 20);
    push({ t: "SQUAD", side: squadFor, players });
    setSquadFor(null);
  };

  const askOpeners = () => {
    if (battingSquad.length < 2 || bowlingSquad.length < 1) {
      Alert.alert(
        "Add the players first",
        "Both squads need names before you can pick who's in.",
      );
      return;
    }
    setPick({
      title: "Who's on strike?",
      names: battingSquad,
      onPick: (striker) =>
        setPick({
          title: "Non-striker",
          names: battingSquad.filter((n) => n !== striker),
          onPick: (nonStriker) =>
            setPick({
              title: "Opening bowler",
              names: bowlingSquad,
              onPick: (bowler) => {
                push({ t: "OPEN", striker, nonStriker, bowler });
                setPick(null);
              },
            }),
        }),
    });
  };

  const askBowler = () =>
    setPick({
      title: "Who's bowling this over?",
      names: bowlingSquad,
      onPick: (name) => {
        push({ t: "BOWLER", name });
        setPick(null);
      },
    });

  const confirmWicket = () => {
    setWicketOpen(false);
    const crease = [s.striker, s.nonStriker].filter((n): n is string => !!n);
    const afterWhoOut = (batter: string | undefined) => {
      const remaining = availableBatters.filter((n) => n !== batter);
      if (remaining.length > 0) {
        setPick({
          title: "Next batter in",
          names: remaining,
          onPick: (newBatter) => {
            push({
              t: "WICKET",
              kind: wicketKind,
              ...(batter ? { batter } : {}),
              newBatter,
            });
            setPick(null);
          },
        });
        return;
      }
      push({ t: "WICKET", kind: wicketKind, ...(batter ? { batter } : {}) });
    };

    // Run-out can be either end — ask who, then who comes in.
    if (wicketKind === "RUN_OUT" && crease.length > 1) {
      setPick({
        title: "Who was run out?",
        names: crease,
        onPick: (batter) => {
          setPick(null);
          afterWhoOut(batter);
        },
      });
      return;
    }
    afterWhoOut(crease.length === 1 ? crease[0] : undefined);
  };

  const beginRetireHurt = () => {
    const crease = [s.striker, s.nonStriker].filter((n): n is string => !!n);
    const afterWhoOut = (batter: string | undefined) => {
      const remaining = availableBatters.filter((n) => n !== batter);
      if (remaining.length > 0) {
        setPick({
          title: "Who comes in?",
          names: remaining,
          onPick: (newBatter) => {
            push({ t: "RETIRE", ...(batter ? { batter } : {}), newBatter });
            setPick(null);
          },
        });
        return;
      }
      push({ t: "RETIRE", ...(batter ? { batter } : {}) });
    };

    if (crease.length > 1) {
      setPick({
        title: "Who is retiring hurt?",
        names: crease,
        onPick: (batter) => {
          setPick(null);
          afterWhoOut(batter);
        },
      });
      return;
    }
    afterWhoOut(crease[0]);
  };

  /** +1 for football / pickleball, tagging the scorer when we know the XI. */
  const addPoint = (side: "A" | "B") => {
    const squad = side === "A" ? s.squadA : s.squadB;
    if (squad.length === 0) {
      push({ t: "POINT", side });
      return;
    }
    setPick({
      title: sport === "FOOTBALL" ? "Who scored?" : "Who won the point?",
      names: [...squad, SKIP],
      onPick: (player) => {
        push(player === SKIP ? { t: "POINT", side } : { t: "POINT", side, player });
        setPick(null);
      },
    });
  };

  const askCard = (side: "A" | "B") => {
    const squad = side === "A" ? s.squadA : s.squadB;
    if (squad.length === 0) {
      Alert.alert("Add the players first", "Cards are recorded against a name.");
      return;
    }
    setPick({
      title: "Who was carded?",
      names: squad,
      onPick: (player) => {
        setPick(null);
        Alert.alert("Card", `Which card for ${player}?`, [
          { text: "Cancel", style: "cancel" },
          {
            text: "Yellow",
            onPress: () => push({ t: "CARD", side, player, kind: "YELLOW" }),
          },
          {
            text: "Red",
            style: "destructive",
            onPress: () => push({ t: "CARD", side, player, kind: "RED" }),
          },
        ]);
      },
    });
  };

  const Pad = ({
    label,
    onPress,
    tone,
    span = 1,
  }: {
    label: string;
    onPress: () => void;
    tone?: "danger" | "muted" | "accent";
    span?: 1 | 2 | 3;
  }) => (
    <Pressable
      onPress={onPress}
      disabled={!scoring}
      style={({ pressed }) => [
        styles.pad,
        span === 2 && styles.padHalf,
        span === 3 && styles.padFull,
        tone === "danger" && styles.padDanger,
        tone === "accent" && styles.padAccent,
        (pressed || !scoring) && { opacity: 0.55 },
      ]}
    >
      <Text
        weight="700"
        numberOfLines={1}
        color={
          tone === "danger"
            ? "#fca5a5"
            : tone === "accent"
              ? colors.emerald400
              : colors.foreground
        }
        style={span > 1 || tone === "muted" ? styles.padSmallText : styles.padText}
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
            {pendingCount > 0 || syncFailed ? (
              <Pressable onPress={() => void flush()} style={styles.syncTag}>
                <CloudOff size={11} color={colors.yellow400} />
                <Text variant="tiny" color={colors.yellow400}>
                  {pendingCount > 0 ? `${pendingCount} to sync` : "Retry sync"}
                </Text>
              </Pressable>
            ) : null}
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
            {
              side: "A" as const,
              name: match.teamAName,
              runs: s.runsA,
              wkts: s.wicketsA,
              balls: s.ballsA,
              striking: cricket && batA,
            },
            {
              side: "B" as const,
              name: match.teamBName,
              runs: s.runsB,
              wkts: s.wicketsB,
              balls: s.ballsB,
              striking: cricket && !batA,
            },
          ].map((t) => (
            <View
              key={t.side}
              style={[styles.boardRow, cricket && !t.striking && { opacity: 0.65 }]}
            >
              <View style={styles.boardName}>
                <Text variant="body" color={colors.foreground} numberOfLines={1}>
                  {t.name}
                </Text>
                {t.striking ? (
                  <Text variant="tiny" weight="700" color={colors.emerald400}>
                    BATTING
                  </Text>
                ) : null}
              </View>
              <Text weight="800" color={colors.foreground} style={styles.score}>
                {cricket ? `${t.runs}/${t.wkts}` : t.runs}
              </Text>
              {cricket ? (
                <Text variant="small" color={colors.zinc500} style={styles.oversCol}>
                  {overs(t.balls)}
                  {match.oversPerInnings ? `/${match.oversPerInnings}` : ""}
                </Text>
              ) : null}
            </View>
          ))}
        </View>

        {/* Squads — the roster is what makes every other tag possible. */}
        {scoring ? (
          <View style={styles.squadRow}>
            {(["A", "B"] as const).map((side) => {
              const names = side === "A" ? s.squadA : s.squadB;
              return (
                <Pressable
                  key={side}
                  onPress={() => openSquad(side)}
                  style={styles.squadBtn}
                >
                  <Users size={13} color={colors.zinc400} />
                  <Text variant="tiny" color={colors.zinc300} numberOfLines={1}>
                    {names.length > 0 ? `${names.length} players` : "Add players"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {/* At the crease. The scorer's most-read three lines. */}
        {cricket && (s.striker || s.nonStriker || s.bowler) ? (
          <View style={styles.crease}>
            {[s.striker, s.nonStriker].map((name, i) =>
              name ? (
                <View key={name} style={styles.creaseRow}>
                  <Text variant="small" color={colors.foreground} numberOfLines={1}>
                    {name}
                    {i === 0 ? " *" : ""}
                  </Text>
                  <Text variant="small" color={colors.zinc400}>
                    {s.batting[name]?.runs ?? 0} ({s.batting[name]?.balls ?? 0})
                  </Text>
                </View>
              ) : null,
            )}
            {s.bowler ? (
              <View style={[styles.creaseRow, styles.creaseDivider]}>
                <Text variant="small" color={colors.zinc300} numberOfLines={1}>
                  {s.bowler}
                </Text>
                <Text variant="small" color={colors.zinc400}>
                  {overs(s.bowling[s.bowler]?.balls ?? 0)}–
                  {s.bowling[s.bowler]?.runs ?? 0}–
                  {s.bowling[s.bowler]?.wickets ?? 0}
                </Text>
              </View>
            ) : null}
            {s.thisOver.length > 0 ? (
              <View style={styles.overStrip}>
                {s.thisOver.map((b, i) => (
                  <View key={`${b}-${i}`} style={styles.ballChip}>
                    <Text variant="tiny" weight="700" color={colors.zinc300}>
                      {b}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            <Text variant="tiny" color={colors.zinc500}>
              Extras{" "}
              {s.extras.wide + s.extras.noBall + s.extras.bye + s.extras.legBye} (wd{" "}
              {s.extras.wide} · nb {s.extras.noBall} · b {s.extras.bye} · lb{" "}
              {s.extras.legBye})
            </Text>
          </View>
        ) : null}

        {!canScore ? (
          <Text variant="small" color={colors.zinc500} style={styles.note}>
            Watching live — the scorer updates this from their phone.
          </Text>
        ) : done ? (
          <Text variant="small" color={colors.zinc500} style={styles.note}>
            This match has finished.
          </Text>
        ) : inningsDone ? (
          // Checked BEFORE the openers/bowler prompts: with the overs gone
          // there is no next bowler to pick, and no ball left to score.
          <View style={styles.crease}>
            <Text variant="bodyStrong" color={colors.foreground}>
              {s.innings === 0 ? "Innings complete" : "Match complete"}
            </Text>
            <Text variant="small" color={colors.zinc400}>
              {inningsDone}
              {s.innings === 0
                ? " Hand over to the other side."
                : " Nothing left to score."}
            </Text>
            {s.innings === 0 ? (
              <Button
                label="End innings"
                variant="primary"
                onPress={() => push({ t: "END_INNINGS" })}
              />
            ) : (
              <Button
                label="End match"
                variant="primary"
                onPress={async () => {
                  await flush();
                  const res = await finishMatch(code);
                  if (res.error) Alert.alert("Couldn't end", res.error);
                  void q.refetch();
                  void qc.invalidateQueries({ queryKey: ["my-matches"] });
                }}
              />
            )}
          </View>
        ) : cricket && !s.striker ? (
          <Button label="Set the openers" variant="primary" onPress={askOpeners} />
        ) : cricket && !s.bowler ? (
          <Button label="Pick the next bowler" variant="primary" onPress={askBowler} />
        ) : (
          <>
            <View style={styles.grid}>
              {cricket ? (
                <>
                  {[0, 1, 2, 3, 4, 6].map((n) => (
                    <Pad
                      key={n}
                      label={String(n)}
                      onPress={() => push({ t: "RUN", runs: n })}
                    />
                  ))}
                  <Pad label="Wide" onPress={() => push({ t: "WIDE" })} />
                  <Pad label="No ball" onPress={() => push({ t: "NO_BALL" })} />
                  <Pad label="Bye" onPress={() => push({ t: "BYE", runs: 1 })} />
                  <Pad label="Leg bye" onPress={() => push({ t: "LEG_BYE", runs: 1 })} />
                  <Pad
                    label="Wicket"
                    tone="danger"
                    span={2}
                    onPress={() => setWicketOpen(true)}
                  />
                  <Pad label="Swap ends" span={2} onPress={() => push({ t: "SWAP" })} />
                  <Pad
                    label="Retired hurt"
                    span={2}
                    onPress={beginRetireHurt}
                  />
                  <Pad
                    label={s.innings === 0 ? "End innings" : "End of play"}
                    span={2}
                    tone="muted"
                    onPress={() =>
                      Alert.alert(
                        "End the innings?",
                        "The other side comes in to bat.",
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "End innings",
                            onPress: () => push({ t: "END_INNINGS" }),
                          },
                        ],
                      )
                    }
                  />
                </>
              ) : (
                <>
                  <Pad
                    label={`+1 ${match.teamAName}`}
                    tone="accent"
                    span={3}
                    onPress={() => addPoint("A")}
                  />
                  <Pad
                    label={`+1 ${match.teamBName}`}
                    tone="accent"
                    span={3}
                    onPress={() => addPoint("B")}
                  />
                  {sport === "FOOTBALL" ? (
                    <>
                      <Pad
                        label={`Card · ${match.teamAName}`}
                        span={2}
                        tone="muted"
                        onPress={() => askCard("A")}
                      />
                      <Pad
                        label={`Card · ${match.teamBName}`}
                        span={2}
                        tone="muted"
                        onPress={() => askCard("B")}
                      />
                    </>
                  ) : null}
                </>
              )}
            </View>

            <View style={styles.footRow}>
              <Pressable
                onPress={undo}
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
                    {
                      text: "End match",
                      style: "destructive",
                      onPress: async () => {
                        // Ship whatever is still queued before locking,
                        // or the last over vanishes.
                        await flush();
                        const res = await finishMatch(code);
                        if (res.error) Alert.alert("Couldn't end", res.error);
                        void q.refetch();
                        void qc.invalidateQueries({ queryKey: ["my-matches"] });
                      },
                    },
                  ])
                }
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

        {/* Goal / point scorers, once anyone has been tagged. */}
        {!cricket && s.scorers.length > 0 ? (
          <View style={styles.crease}>
            <Text variant="tiny" weight="700" color={colors.zinc400}>
              SCORERS
            </Text>
            {s.scorers.map((g, i) => (
              <View key={`${g.player}-${i}`} style={styles.creaseRow}>
                <Text variant="small" color={colors.foreground} numberOfLines={1}>
                  {g.player}
                </Text>
                <Text variant="small" color={colors.zinc500}>
                  {g.side === "A" ? match.teamAName : match.teamBName}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {/* ---- Squad editor ---- */}
      {/* The only sheet here with a text input, so the only one that needs
          to lift: the keyboard covers a bottom sheet completely, hiding
          both the textarea and Save. Same behaviour as ui/Screen's
          avoidKeyboard — padding on iOS, Android resizes the window itself. */}
      <Modal visible={squadFor !== null} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.sheetWrap}
          // "height" on Android rather than the `undefined` ui/Screen uses:
          // a RN Modal is its own window and doesn't inherit the activity's
          // adjustResize, so the sheet would stay put under the keyboard.
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <Pressable style={styles.backdrop} onPress={() => setSquadFor(null)} />
          <View style={styles.sheet}>
            <Text variant="bodyStrong" color={colors.foreground}>
              {squadFor === "A" ? match.teamAName : match.teamBName} — players
            </Text>
            <Text variant="tiny" color={colors.zinc500}>
              One name per line. You can add more later.
            </Text>
            <TextInput
              value={squadText}
              onChangeText={setSquadText}
              multiline
              placeholder={"Rohit\nVirat\nBumrah"}
              placeholderTextColor={colors.zinc600}
              style={styles.squadInput}
            />
            <Button label="Save players" variant="primary" onPress={saveSquad} />
            <Button
              label="Cancel"
              variant="ghost"
              size="sm"
              onPress={() => setSquadFor(null)}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ---- How the wicket fell ---- */}
      <Modal visible={wicketOpen} transparent animationType="slide">
        <View style={styles.sheetWrap}>
          <Pressable style={styles.backdrop} onPress={() => setWicketOpen(false)} />
          <View style={styles.sheet}>
            <Text variant="bodyStrong" color={colors.foreground}>
              How did {s.striker ?? "the batter"} go?
            </Text>
            <View style={styles.kindRow}>
              {WICKET_KINDS.map((w) => {
                const on = wicketKind === w.k;
                return (
                  <Pressable
                    key={w.k}
                    onPress={() => setWicketKind(w.k)}
                    style={[styles.kindChip, on && styles.kindChipOn]}
                  >
                    <Text
                      variant="small"
                      color={on ? colors.emerald400 : colors.zinc300}
                    >
                      {w.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Button label="Confirm wicket" variant="primary" onPress={confirmWicket} />
            <Button
              label="Cancel"
              variant="ghost"
              size="sm"
              onPress={() => setWicketOpen(false)}
            />
          </View>
        </View>
      </Modal>

      {/* ---- Name picker: openers, next bowler, new batter, scorer ---- */}
      <Modal visible={pick !== null} transparent animationType="slide">
        <View style={styles.sheetWrap}>
          <Pressable style={styles.backdrop} onPress={() => setPick(null)} />
          <View style={styles.sheet}>
            <Text variant="bodyStrong" color={colors.foreground}>
              {pick?.title}
            </Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {(pick?.names ?? []).map((n) => (
                <Pressable key={n} onPress={() => pick?.onPick(n)} style={styles.nameRow}>
                  <Text variant="body" color={colors.foreground}>
                    {n}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <Button
              label="Cancel"
              variant="ghost"
              size="sm"
              onPress={() => setPick(null)}
            />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

/** Sentinel row in the scorer picker for "don't tag anyone". */
const SKIP = "— skip —";

const styles = StyleSheet.create({
  scroll: {
    padding: spacing["5"],
    gap: spacing["4"],
    paddingBottom: spacing["10"],
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing["2"],
  },
  liveTag: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  syncTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(250,204,21,0.35)",
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
  },
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
    gap: spacing["3"],
    paddingVertical: spacing["2"],
  },
  boardName: { flex: 1, gap: 2, minWidth: 0 },
  score: { fontSize: 24 },
  // Overs get a fixed column so the two rows line up instead of drifting
  // with the width of the score beside them.
  oversCol: { width: 58, textAlign: "right" },
  squadRow: { flexDirection: "row", gap: spacing["2"] },
  squadBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
  },
  crease: {
    gap: 6,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.card,
    padding: spacing["4"],
  },
  creaseRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing["3"],
  },
  creaseDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.zinc800,
    paddingTop: 6,
    marginTop: 2,
  },
  overStrip: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 2 },
  ballChip: {
    minWidth: 26,
    alignItems: "center",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  note: { textAlign: "center", marginTop: spacing["2"] },
  // 3-up grid: 3 × 31.5% + 2 gaps clears 100% on every phone width we
  // support. The old 4-up pad at 23% left a ragged tail on narrow ones.
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing["2"] },
  pad: {
    width: "31.5%",
    alignItems: "center",
    justifyContent: "center",
    height: 58,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: colors.zinc900,
    paddingHorizontal: spacing["2"],
  },
  padHalf: { width: "48.5%" },
  padFull: { width: "100%" },
  padDanger: {
    borderColor: "rgba(239,68,68,0.4)",
    backgroundColor: "rgba(239,68,68,0.10)",
  },
  padAccent: {
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_10,
  },
  padText: { fontSize: 20 },
  padSmallText: { fontSize: 14 },
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
  sheetWrap: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    gap: spacing["3"],
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.card,
    padding: spacing["5"],
  },
  squadInput: {
    // Kept short on purpose: with the keyboard up the sheet has to fit
    // title + input + both buttons in what's left of the screen, and a
    // tall box pushed the Save button back off the bottom.
    minHeight: 96,
    maxHeight: 150,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: colors.inputBackground,
    color: colors.foreground,
    padding: spacing["3"],
    textAlignVertical: "top",
  },
  kindRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing["2"] },
  kindChip: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
  },
  kindChipOn: {
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_10,
  },
  nameRow: {
    paddingVertical: spacing["3"],
    borderBottomWidth: 1,
    borderBottomColor: colors.zinc800,
  },
});
