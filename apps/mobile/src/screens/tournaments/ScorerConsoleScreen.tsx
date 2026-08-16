import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ChevronLeft, Play, Radio, Square, Undo2, X } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { colors, radius } from "../../theme";
import {
  fetchScorerBoot,
  sendScorerAction,
  type ScorerBoot,
  type ScorerMatch,
  type ScorerTeam,
  addScorerPlayer,
} from "../../lib/tournaments";
import type { RootStackParamList } from "../../navigation/types";

// Native twin of the web scorer console (app/score/[code]). Same routes,
// same rules — the code in the route params is the credential.
//
// Layout follows what the job actually is: between deliveries the scorer
// looks at the score and taps a run. So the scoreboard is PINNED (never
// scrolls away) and the run pad sits directly under the thumb. Choosing
// players is occasional — a new batter on a wicket, a new bowler each
// over — so the pickers live in a sheet that opens itself exactly when
// the server says one is needed, instead of twelve chips permanently
// pushing the pad off-screen.

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Rt = RouteProp<RootStackParamList, "ScorerConsole">;

type CricketCurrent = {
  strikerId: string | null;
  nonStrikerId: string | null;
  bowlerId: string | null;
  batters: { id: string; runs: number; balls: number }[];
  bowler: { id: string; balls: number; runs: number; wickets: number } | null;
  thisOver: string[];
  ballsThisOver: number;
  partnership: { runs: number; balls: number };
  needsBatter: boolean;
  needsBowler: boolean;
  dismissed: string[];
  spells: { id: string; balls: number }[];
  lastOverBowlerId: string | null;
};
type CricketState = {
  inning: number;
  battingTeamId: string | null;
  innings: { teamId: string; runs: number; wickets: number; balls: number }[];
  target: number | null;
  current?: CricketCurrent;
};
type PickleState = {
  current: { home: number; away: number };
  gamesWon: { home: number; away: number };
  servingTeamId?: string | null;
  gameNumber?: number;
};
type FootballLive = {
  current?: {
    lastGoal: { teamId: string; memberId: string | null; assistId: string | null } | null;
  };
};

type PickerKind = "striker" | "nonStriker" | "bowler" | "goal";

const overs = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`;

function clockDisplay(m: ScorerMatch): string {
  const base =
    m.clockElapsedSec +
    (m.clockStartedAt ? Math.max(0, Math.round((Date.now() - new Date(m.clockStartedAt).getTime()) / 1000)) : 0);
  return `${Math.floor(base / 60)}:${String(base % 60).padStart(2, "0")}`;
}

/** One delivery in the over strip. */
function OverBall({ label }: { label: string }) {
  const wicket = label === "W";
  const boundary = label === "4" || label === "6";
  return (
    <View style={[s.overBall, wicket && s.overBallW, boundary && s.overBallB]}>
      <Text style={[s.overBallText, wicket && { color: "#fca5a5" }, boundary && { color: colors.emerald400 }]}>
        {label}
      </Text>
    </View>
  );
}

type PadTone = "boundary" | "wicket" | "extra" | "info";

const PAD_TINT: Record<PadTone, string> = {
  boundary: colors.emerald400,
  wicket: "#f87171",
  extra: "#fbbf24",
  info: "#7dd3fc",
};

/**
 * One key on the run pad.
 *
 * Three earlier attempts tried to centre the glyph by tuning `lineHeight`
 * against the font's metrics, and each one drifted on a real Android
 * handset. So this deliberately leaves nothing to measure:
 *   - the key is a FIXED height, not an aspectRatio, so its box is known;
 *   - the glyph sits in a Text whose `height` equals its own `lineHeight`,
 *     i.e. exactly one line box, positioned by `textAlignVertical`;
 *   - `allowFontScaling={false}` keeps the device's text-size setting from
 *     inflating the font past that box (a scaled font inside an unscaled
 *     lineHeight is what pins a glyph to the floor of its key);
 *   - the caption underneath gives the key a second line, so the content
 *     reads as a balanced block rather than one glyph hunting for centre.
 * Every key shares one glyph box, so the captions line up across a row
 * even where the glyph is set smaller (Wd / Nb).
 */
function PadKey({
  glyph,
  caption,
  tone,
  busy,
  onPress,
}: {
  glyph: string;
  caption: string;
  tone?: PadTone;
  busy: boolean;
  onPress: () => void;
}) {
  const tint = tone ? PAD_TINT[tone] : colors.foreground;
  const small = glyph.length > 1;
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        s.key,
        tone === "boundary" && s.keyBoundary,
        tone === "wicket" && s.keyWicket,
        tone === "extra" && s.keyExtra,
        tone === "info" && s.keyInfo,
        pressed && s.keyPressed,
        busy && s.keyBusy,
      ]}
    >
      <Text allowFontScaling={false} style={[s.keyGlyph, small && s.keyGlyphSm, { color: tint }]}>
        {glyph}
      </Text>
      <Text allowFontScaling={false} style={[s.keyCaption, tone ? { color: tint } : null]}>
        {caption}
      </Text>
    </Pressable>
  );
}

export function ScorerConsoleScreen() {
  const navigation = useNavigation<Nav>();
  const { code } = useRoute<Rt>().params;

  const [boot, setBoot] = useState<ScorerBoot | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0); // re-render for the football clock
  const [picker, setPicker] = useState<PickerKind | null>(null);

  // Who's out there is owned by the SERVER (folded from the event log), so
  // it survives a reload and two scorers see the same thing. These locals
  // only fill the gap while a new batter/bowler hasn't been chosen yet.
  const [pickStriker, setPickStriker] = useState("");
  const [pickNonStriker, setPickNonStriker] = useState("");
  const [pickBowler, setPickBowler] = useState("");
  /** Overs for this match, typed at the toss. Seeded from the tournament. */
  const [startOvers, setStartOvers] = useState("");
  /** Open when the scorer taps OUT — how, and (for a run-out) who. */
  const [wicketSheet, setWicketSheet] = useState(false);
  /** Open when the scorer taps Retire — which batter walks off. */
  const [retireSheet, setRetireSheet] = useState(false);
  /** Step two of a wicket. A catch, stumping or run-out belongs to a
   *  fielder, and "c — b Khan" on the scorecard is worth nothing, so the
   *  half-built wicket waits here until the scorer names them (or says
   *  they didn't see it) and the whole thing is logged as one delivery.
   *  Mirrors needsFielder() in lib/cricket-dismissal.ts on the server. */
  const [fielderFor, setFielderFor] = useState<
    { dismissal: string; outBatterId?: string } | null
  >(null);
  /** Run out only: which batter was out. A run-out is the one dismissal
   *  that can take either end, so it can't be inferred — and it must be
   *  asked from a row that is visible without scrolling, which is why
   *  "Run out" now sits with the other kinds rather than in a section
   *  below them that a phone screen cuts off. */
  const [outBatterFor, setOutBatterFor] = useState<string | null>(null);
  // Add-a-player, inline in the picker. A squad that was never entered
  // used to dead-end here with "add them from the admin console" — no
  // use to a volunteer at the boundary with the batter waiting.
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setBoot(await fetchScorerBoot(code));
      setInvalid(false);
      setError(null);
    } catch (e) {
      // Only a genuinely bad code (404) kills the screen. A throttle or a
      // network blip must never masquerade as "invalid code", and must
      // never tear down a console mid-match.
      const status = (e as { status?: number })?.status;
      if (status === 404 && !boot) setInvalid(true);
      else if (status === 429) setError("Too many attempts — wait a minute and retry.");
    }
  }, [code, boot]);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 6000);
    const clock = setInterval(() => setTick((x) => x + 1), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [refresh]);

  const match = useMemo(() => boot?.matches.find((m) => m.id === matchId) || null, [boot, matchId]);

  const liveCur = (match?.liveState as CricketState | null)?.current;
  const strikerId = liveCur?.strikerId || pickStriker;
  const nonStrikerId = liveCur?.nonStrikerId || pickNonStriker;
  const bowlerId = liveCur?.bowlerId || pickBowler;
  const needsBatter = !!liveCur?.needsBatter && !pickStriker;
  const needsBowler = !!liveCur?.needsBowler && !pickBowler;

  // These locals are only an optimistic echo of the fold. At the end of
  // an over the server clears the bowler, but `bowlerId` falls back to
  // the local pick — which still held LAST over's bowler, so the console
  // thought someone was bowling and never opened the picker. Drop the
  // echo the moment the server says the seat is empty.
  useEffect(() => {
    if (liveCur?.needsBowler) setPickBowler("");
  }, [liveCur?.needsBowler]);
  useEffect(() => {
    if (liveCur?.needsBatter) {
      setPickStriker("");
      setPickNonStriker("");
    }
  }, [liveCur?.needsBatter]);

  // What the next delivery is still missing. needsBatter/needsBowler only
  // fire AFTER a wicket or a completed over — at the start of an innings
  // both ends are simply empty, which is how runs used to get logged with
  // nobody on strike and nobody bowling.
  const cricketStarted = ((match?.liveState as CricketState | null)?.inning ?? 0) > 0;
  // Innings closed by the overs limit — the server refuses further balls.
  // The cap the match is actually being played to — its own overs when
  // the scorer set them at the toss, otherwise the tournament's.
  const oversCap = match?.oversPerInnings ?? boot?.tournament.oversPerInnings ?? 0;
  const liveInn = (match?.liveState as CricketState | null)?.innings?.slice(-1)[0];
  const inningsDone = oversCap > 0 && !!liveInn && liveInn.balls >= oversCap * 6;
  const missing: "striker" | "bowler" | null =
    boot?.tournament.sport === "CRICKET" && cricketStarted && !inningsDone
      ? !strikerId
        ? "striker"
        : !bowlerId
          ? "bowler"
          : null
      : null;

  // The pad asks for what it needs, the moment it needs it — no hunting
  // through a wall of chips after every wicket. Keyed on `missing`, so
  // closing the sheet doesn't immediately reopen it; the pad stays
  // disabled behind a hint instead.
  const padLocked = busy || !!missing || inningsDone;

  useEffect(() => {
    if (missing) setPicker(missing);
  }, [missing]);

  const send = async (payload: Record<string, unknown>) => {
    if (!matchId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await sendScorerAction(code, { matchId, ...payload } as never);
      if (res?.error) {
        if (res.needsWinner) askWinner();
        else setError(res.error);
        return;
      }
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      if (/tied|winner/i.test(msg)) askWinner();
      else setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const askWinner = () => {
    if (!match) return;
    Alert.alert("Scores level", "Who takes it?", [
      { text: match.homeTeam.name, onPress: () => void end(match.homeTeam.id) },
      { text: match.awayTeam.name, onPress: () => void end(match.awayTeam.id) },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const end = async (winnerTeamId?: string) =>
    send({ action: "end", ...(winnerTeamId ? { winnerTeamId } : {}) });

  const ev = (kind: string, extra: Record<string, unknown> = {}) =>
    send({ action: "event", event: { kind, ...extra } });

  const resetPlayers = () => {
    setPickStriker("");
    setPickNonStriker("");
    setPickBowler("");
  };

  const swapStrike = () => {
    setPickStriker(nonStrikerId);
    setPickNonStriker(strikerId);
  };

  /** One delivery, attributed to the striker + bowler. Rotation and the
   *  over/wicket bookkeeping live in the fold; the pad just reports. */
  const ball = async (data: {
    runs: number;
    extra?: string;
    wicket?: boolean;
    /** How they got out — run-outs are the ones that need naming. */
    dismissal?: string;
    /** Who went. Omitted means the striker, right for all but a run-out. */
    outBatterId?: string;
    /** Who caught / stumped / ran them out, so the card can say so. */
    fielderId?: string;
  }) => {
    await send({
      action: "event",
      event: {
        kind: "BALL",
        ...(strikerId ? { memberId: strikerId } : {}),
        data: {
          ...data,
          ...(strikerId ? { batterId: strikerId } : {}),
          ...(bowlerId ? { bowlerId } : {}),
        },
      },
    });
    // Rotation used to be faked here, because the server only knew who
    // faced. It now owns the crease and crosses the batsmen itself — on
    // byes and off odd runs from a wide too, which this never did — so
    // the pad just drops its echo and re-reads the fold.
    setPickStriker("");
    setPickNonStriker("");
  };

  // ── Non-match states ──
  if (invalid) {
    return (
      <Screen>
        <View style={s.centre}>
          <Text style={s.bigMsg}>Invalid scorer code</Text>
          <Text style={s.dim}>Check the code with the tournament admin.</Text>
          <Pressable onPress={() => navigation.goBack()} style={[s.wideBtn, s.greenBtn, { paddingHorizontal: 28 }]}>
            <Text style={s.greenText}>Back</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }
  if (!boot) {
    return (
      <Screen>
        <View style={s.centre}>
          <ActivityIndicator size="large" color={colors.emerald400} />
        </View>
      </Screen>
    );
  }

  // ── Match picker ──
  if (!match) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={s.pickerList}>
          <Text style={s.kicker}>SCORER CONSOLE</Text>
          <Text style={s.h1}>{boot.tournament.name}</Text>
          <Text style={s.dim}>Pick a match to score.</Text>
          {boot.matches.map((m) => (
            <Pressable
              key={m.id}
              onPress={() => {
                resetPlayers();
                setMatchId(m.id);
              }}
              style={s.matchCard}
            >
              <View style={s.rowBetween}>
                <Text style={s.matchLabel}>{m.roundLabel}</Text>
                {m.status === "LIVE" && (
                  <View style={s.liveRow}>
                    <Radio size={11} color="#f87171" />
                    <Text style={s.liveText}>LIVE</Text>
                  </View>
                )}
              </View>
              <Text style={s.matchTeams}>
                {m.homeTeam.name} <Text style={{ color: colors.zinc600 }}>vs</Text> {m.awayTeam.name}
              </Text>
            </Pressable>
          ))}
          {boot.matches.length === 0 && (
            <View style={s.matchCard}>
              <Text style={s.dim}>No scoreable matches right now.</Text>
            </View>
          )}
        </ScrollView>
      </Screen>
    );
  }

  const sport = boot.tournament.sport;
  const cs = (match.liveState || null) as CricketState | null;
  const ps = (match.liveState || null) as PickleState | null;
  const batting = cs?.battingTeamId === match.awayTeam.id ? match.awayTeam : match.homeTeam;
  // Whoever isn't batting is in the field — catchers, keeper and run-out
  // throwers all come from this side.
  const fielding = batting.id === match.homeTeam.id ? match.awayTeam : match.homeTeam;
  // Cricket can't start without an over limit: 0 reads as "unlimited"
  // downstream and quietly disables both the innings close and the NRR
  // all-out quota. The server refuses it too — this just stops the scorer
  // from finding out by tapping.
  const oversOk =
    sport !== "CRICKET" || (Number(startOvers) >= 1 && Number(startOvers) <= 90);
  const bowling = batting.id === match.homeTeam.id ? match.awayTeam : match.homeTeam;
  const inn = cs?.innings?.[cs.innings.length - 1];
  const allPlayers = [...match.homeTeam.members, ...match.awayTeam.members];
  const nameOf = (id: string | null) => allPlayers.find((p) => p.id === id)?.name || null;
  const figs = (id: string | null) => liveCur?.batters.find((b) => b.id === id) || null;

  const maxOvers = boot.tournament.maxOversPerBowler || 0;
  const pickerTeam: ScorerTeam | null =
    picker === "bowler" ? bowling : picker === "goal" ? null : picker ? batting : null;
  const pickerValue =
    picker === "striker" ? strikerId : picker === "nonStriker" ? nonStrikerId : picker === "bowler" ? bowlerId : pickStriker;
  /** Create the player, then select them straight away — the scorer
   *  opened this sheet to choose someone, so making them tap the new name
   *  afterwards is a step for nothing. */
  const submitNewPlayer = async () => {
    const name = newName.trim();
    if (!name || !pickerTeam || adding) return;
    setAdding(true);
    setError(null);
    try {
      const r = await addScorerPlayer(code, pickerTeam.id, name);
      if (r.error || !r.member) {
        setError(r.error || "Couldn't add that player");
        return;
      }
      const created = r.member;
      // Fold into the local boot payload so the list updates now rather
      // than after a refetch — the console polls, but the scorer is
      // mid-over and shouldn't wait for the next tick.
      setBoot((b) =>
        b
          ? {
              ...b,
              matches: b.matches.map((m) =>
                m.id !== match.id
                  ? m
                  : {
                      ...m,
                      homeTeam:
                        m.homeTeam.id === pickerTeam.id
                          ? { ...m.homeTeam, members: [...m.homeTeam.members, created] }
                          : m.homeTeam,
                      awayTeam:
                        m.awayTeam.id === pickerTeam.id
                          ? { ...m.awayTeam, members: [...m.awayTeam.members, created] }
                          : m.awayTeam,
                    },
              ),
            }
          : b,
      );
      setNewName("");
      applyPick(created.id);
    } finally {
      setAdding(false);
    }
  };

  const applyPick = (id: string) => {
    if (picker === "striker") setPickStriker(id);
    else if (picker === "nonStriker") setPickNonStriker(id);
    else if (picker === "bowler") setPickBowler(id);
    else if (picker === "goal") setPickStriker(id);
    // Lock the pair on the server. Without this the crease would live
    // only in this screen and the fold could never rotate it — the
    // bowler needs no event, it rides along on each BALL.
    if (picker === "striker" || picker === "nonStriker") {
      void ev("CREASE", {
        data: picker === "striker" ? { strikerId: id } : { nonStrikerId: id },
      });
    }
    setPicker(null);
  };

  return (
    <Screen>
      <View style={s.root}>
        {/* ══ PINNED SCOREBOARD — never scrolls away ══ */}
        <View style={s.board}>
          <View style={s.boardTop}>
            <Pressable onPress={() => setMatchId(null)} hitSlop={8} style={s.backRow}>
              <ChevronLeft size={16} color={colors.zinc400} />
              <Text style={s.backText}>Matches</Text>
            </Pressable>
            <Text style={s.matchLabel} numberOfLines={1}>
              {match.roundLabel}
            </Text>
            {match.status === "LIVE" && (
              <View style={s.liveRow}>
                <Radio size={11} color="#f87171" />
                <Text style={s.liveText}>LIVE</Text>
              </View>
            )}
          </View>

          {/* Score line */}
          {sport === "CRICKET" ? (
            <View style={s.scoreLine}>
              <Text style={s.battingTeam} numberOfLines={1}>
                {batting.name}
              </Text>
              <Text style={s.scoreBig}>
                {inn ? `${inn.runs}/${inn.wickets}` : "0/0"}
                <Text style={s.scoreOvers}> ({inn ? overs(inn.balls) : "0.0"})</Text>
              </Text>
            </View>
          ) : (
            <View style={s.scoreLineTwo}>
              {[match.homeTeam, match.awayTeam].map((team, i) => (
                <View key={team.id} style={{ flex: 1, alignItems: i === 0 ? "flex-start" : "flex-end" }}>
                  <Text style={s.teamSmall} numberOfLines={1}>
                    {team.name}
                  </Text>
                  <Text style={s.scoreBig}>{(i === 0 ? match.homeScore : match.awayScore) ?? 0}</Text>
                </View>
              ))}
            </View>
          )}

          {sport === "CRICKET" && cs?.target != null && (
            <Text style={s.target}>
              Target {cs.target} · need {Math.max(0, cs.target - (inn?.runs ?? 0))} more
            </Text>
          )}
          {sport === "FOOTBALL" && (
            <Text style={[s.target, match.clockStartedAt ? { color: colors.emerald400 } : null]}>
              {clockDisplay(match)}
            </Text>
          )}
          {sport === "PICKLEBALL" && ps && (
            <Text style={s.target}>
              Game {ps.gameNumber ?? 1} · {ps.current.home}–{ps.current.away}
              {ps.servingTeamId
                ? ` · serving ${ps.servingTeamId === match.homeTeam.id ? match.homeTeam.name : match.awayTeam.name}`
                : ""}
            </Text>
          )}

          {/* Crease — tap a name to change who's there */}
          {sport === "CRICKET" && cs && cs.inning > 0 && (
            <View style={s.crease}>
              {[
                { id: strikerId, kind: "striker" as PickerKind, onStrike: true },
                { id: nonStrikerId, kind: "nonStriker" as PickerKind, onStrike: false },
              ].map((row) => (
                <Pressable key={row.kind} onPress={() => setPicker(row.kind)} style={s.creaseRow}>
                  <Text
                    style={[s.creaseName, row.onStrike && s.creaseOnStrike]}
                    numberOfLines={1}
                  >
                    {row.id ? nameOf(row.id) : row.onStrike ? "Tap to pick striker" : "Tap to pick non-striker"}
                    {row.id && row.onStrike ? " *" : ""}
                  </Text>
                  <Text style={s.creaseFigs}>
                    {row.id ? `${figs(row.id)?.runs ?? 0} (${figs(row.id)?.balls ?? 0})` : "—"}
                  </Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setPicker("bowler")} style={[s.creaseRow, s.creaseBowler]}>
                <Text style={s.creaseName} numberOfLines={1}>
                  {bowlerId ? nameOf(bowlerId) : "Tap to pick bowler"}
                </Text>
                <Text style={s.creaseFigs}>
                  {liveCur?.bowler
                    ? `${overs(liveCur.bowler.balls)}–${liveCur.bowler.runs}–${liveCur.bowler.wickets}`
                    : "—"}
                </Text>
              </Pressable>

              <View style={s.overRow}>
                <View style={s.overStrip}>
                  {(liveCur?.thisOver.length ?? 0) === 0 ? (
                    <Text style={s.overEmpty}>New over</Text>
                  ) : (
                    liveCur!.thisOver.map((b, i) => <OverBall key={i} label={b} />)
                  )}
                </View>
                <Pressable onPress={swapStrike} disabled={!nonStrikerId} hitSlop={6}>
                  <Text style={[s.swap, !nonStrikerId && { opacity: 0.35 }]}>⇄ Swap</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>

        {!!error && <Text style={s.error}>{error}</Text>}

        {/* ══ CONTROLS — scroll only if the phone is short ══ */}
        <ScrollView
          contentContainerStyle={s.controls}
          showsVerticalScrollIndicator={false}
        >
          {match.status === "SCHEDULED" && (
            <>
              {/* Overs are agreed at the toss, so they're captured here
                  rather than assumed: the innings cap and the Net Run
                  Rate quota both read this number, and a match cut short
                  would otherwise be scored against overs nobody played. */}
              {sport === "CRICKET" && (
                <View style={s.oversBox}>
                  <Text style={s.oversLabel}>Overs per side</Text>
                  <TextInput
                    value={startOvers}
                    onChangeText={(t) => setStartOvers(t.replace(/[^\d]/g, ""))}
                    keyboardType="number-pad"
                    placeholder="e.g. 10"
                    placeholderTextColor={colors.zinc500}
                    style={s.oversInput}
                  />
                  <Text style={s.oversHint}>
                    {oversOk
                      ? `Starts from the tournament's ${boot?.tournament.oversPerInnings || 0} — change it if this match is shorter.`
                      : "Required, 1–90. The innings close and the net run rate both read this number."}
                  </Text>
                </View>
              )}
              <Pressable
                onPress={() =>
                  send({
                    action: "start",
                    ...(sport === "CRICKET"
                      ? { oversPerInnings: Number(startOvers) || 0 }
                      : {}),
                  })
                }
                disabled={busy || !oversOk}
                style={[s.wideBtn, s.greenBtn, !oversOk && { opacity: 0.4 }]}
              >
                <Play size={18} color={colors.emerald400} />
                <Text style={s.greenText}>Start Match</Text>
              </Pressable>
            </>
          )}

          {match.status === "LIVE" && sport === "CRICKET" && (
            <>
              {(!cs || cs.inning === 0) ? (
                <View style={s.row}>
                  {[match.homeTeam, match.awayTeam].map((team) => (
                    <Pressable
                      key={team.id}
                      onPress={() => {
                        resetPlayers();
                        ev("INNINGS_START", { teamId: team.id });
                      }}
                      disabled={busy}
                      style={[s.wideBtn, s.blueBtn, { flex: 1 }]}
                    >
                      <Text style={s.blueText}>{team.name} bat first</Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <>
                  {/* A delivery needs someone on strike and someone
                      bowling — the server rejects it otherwise, so say so
                      here rather than letting the tap fail. */}
                  {inningsDone && (
                    <View style={s.doneBanner}>
                      <Text style={s.doneBannerText}>
                        Innings complete — {oversCap} overs bowled. End the innings.
                      </Text>
                    </View>
                  )}
                  {!!missing && (
                    <Pressable onPress={() => setPicker(missing)} style={s.needBanner}>
                      <Text style={s.needBannerText}>
                        {missing === "striker"
                          ? "Pick the batter on strike to start scoring"
                          : "Pick the bowler to start scoring"}
                      </Text>
                    </Pressable>
                  )}
                  {/* Run pad — the 95% action, right under the thumb */}
                  <View style={s.padRow}>
                    <PadKey glyph="0" caption="DOT" busy={padLocked} onPress={() => ball({ runs: 0 })} />
                    <PadKey glyph="1" caption="RUN" busy={padLocked} onPress={() => ball({ runs: 1 })} />
                    <PadKey glyph="2" caption="RUNS" busy={padLocked} onPress={() => ball({ runs: 2 })} />
                    <PadKey glyph="3" caption="RUNS" busy={padLocked} onPress={() => ball({ runs: 3 })} />
                  </View>
                  <View style={s.padRow}>
                    <PadKey glyph="4" caption="FOUR" tone="boundary" busy={padLocked} onPress={() => ball({ runs: 4 })} />
                    <PadKey glyph="5" caption="RUNS" busy={padLocked} onPress={() => ball({ runs: 5 })} />
                    <PadKey glyph="6" caption="SIX" tone="boundary" busy={padLocked} onPress={() => ball({ runs: 6 })} />
                    <PadKey glyph="W" caption="OUT" tone="wicket" busy={padLocked} onPress={() => setWicketSheet(true)} />
                    <PadKey glyph="Wd" caption="WIDE" tone="extra" busy={padLocked} onPress={() => ball({ runs: 1, extra: "wd" })} />
                  </View>

                  {/* ── Extras, with the runs that came with them ────────
                      `runs` is always the TOTAL the delivery adds, penalty
                      included: a wide they run one off is 2. One tap each —
                      a scorer has a ball every twenty seconds and shouldn't
                      be inside a menu. Leg byes were never on the pad,
                      though the engine has always accepted them. */}
                  {(
                    [
                      ["wd", "Wide", [["wd", 1], ["+1", 2], ["+2", 3], ["+3", 4], ["+4", 5]]],
                      ["nb", "No ball", [["nb", 1], ["+1", 2], ["+2", 3], ["+4", 5], ["+6", 7]]],
                      ["b", "Byes", [["1", 1], ["2", 2], ["3", 3], ["4", 4]]],
                      ["lb", "Leg byes", [["1", 1], ["2", 2], ["3", 3], ["4", 4]]],
                    ] as [string, string, [string, number][]][]
                  ).map(([kind, label, opts]) => (
                    <View key={kind} style={s.extraRow}>
                      <Text style={s.extraLabel}>{label}</Text>
                      <View style={s.extraOpts}>
                        {opts.map(([text, runs]) => (
                          <Pressable
                            key={text}
                            disabled={padLocked}
                            onPress={() => ball({ runs, extra: kind })}
                            style={[s.extraChip, padLocked && { opacity: 0.4 }]}
                          >
                            <Text
                              style={{
                                color: kind === "wd" || kind === "nb" ? "#fbbf24" : colors.zinc300,
                                fontSize: 13,
                                fontWeight: "600",
                              }}
                            >
                              {text}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  ))}

                  <View style={s.padRow}>
                    <PadKey glyph="Nb" caption="NO BALL" tone="extra" busy={padLocked} onPress={() => ball({ runs: 1, extra: "nb" })} />
                    <PadKey glyph="B" caption="BYE" busy={padLocked} onPress={() => ball({ runs: 1, extra: "b" })} />
                    {/* Retired hurt is neither a delivery nor a wicket. */}
                    <PadKey
                      glyph="⏻"
                      caption="RETIRE"
                      busy={busy || (!strikerId && !nonStrikerId)}
                      onPress={() => setRetireSheet(true)}
                    />
                    {cs.inning === 1 ? (
                      <PadKey
                        glyph="⤁"
                        caption="END INNS"
                        tone="info"
                        busy={busy}
                        onPress={() => {
                          const other = cs.battingTeamId === match.homeTeam.id ? match.awayTeam.id : match.homeTeam.id;
                          resetPlayers();
                          ev("INNINGS_START", { teamId: other });
                        }}
                      />
                    ) : (
                      // Keep the row four keys wide so the grid never reflows.
                      <View style={s.padSpacer} />
                    )}
                    <View style={s.padSpacer} />
                  </View>
                </>
              )}
            </>
          )}

          {match.status === "LIVE" && sport === "FOOTBALL" && (
            <>
              <Pressable
                onPress={() => ev(match.clockStartedAt ? "CLOCK_STOP" : "CLOCK_START")}
                disabled={busy}
                style={[s.wideBtn, match.clockStartedAt ? s.amberBtn : s.greenBtn]}
              >
                {match.clockStartedAt ? <Square size={16} color="#fbbf24" /> : <Play size={16} color={colors.emerald400} />}
                <Text style={match.clockStartedAt ? s.amberText : s.greenText}>
                  {match.clockStartedAt ? "Stop clock" : "Start clock"}
                </Text>
              </Pressable>

              <Pressable onPress={() => setPicker("goal")} style={s.scorerRow}>
                <Text style={s.scorerLabel}>Goal scorer</Text>
                <Text style={s.scorerValue}>{nameOf(pickStriker) || "Tap to choose (optional)"}</Text>
              </Pressable>

              <View style={s.row}>
                {[match.homeTeam, match.awayTeam].map((team) => (
                  <Pressable
                    key={team.id}
                    onPress={async () => {
                      const scorer = team.members.some((p) => p.id === pickStriker) ? pickStriker : "";
                      await send({
                        action: "event",
                        event: { kind: "GOAL", teamId: team.id, ...(scorer ? { memberId: scorer } : {}) },
                      });
                      setPickStriker("");
                    }}
                    disabled={busy}
                    style={[s.goalBtn, { flex: 1 }]}
                  >
                    <Text style={{ fontSize: 26 }}>⚽</Text>
                    <Text style={s.goalText} numberOfLines={1}>{team.name}</Text>
                  </Pressable>
                ))}
              </View>
              {(() => {
                const lg = (match.liveState as FootballLive | null)?.current?.lastGoal;
                if (!lg) return null;
                const t = lg.teamId === match.homeTeam.id ? match.homeTeam : match.awayTeam;
                return (
                  <Text style={s.lastGoal}>
                    Last goal · {t.name}
                    {lg.memberId ? ` — ${nameOf(lg.memberId)}` : ""}
                  </Text>
                );
              })()}
            </>
          )}

          {match.status === "LIVE" && sport === "PICKLEBALL" && (
            <>
              <View style={s.row}>
                {[match.homeTeam, match.awayTeam].map((team) => (
                  <Pressable
                    key={team.id}
                    onPress={() => ev("POINT", { teamId: team.id })}
                    disabled={busy}
                    style={[s.goalBtn, { flex: 1 }]}
                  >
                    <Text style={s.plusOne}>+1</Text>
                    <Text style={s.goalText} numberOfLines={1}>{team.name}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable onPress={() => ev("GAME_END")} disabled={busy} style={[s.chipBtn, { alignSelf: "stretch" }]}>
                <Text style={[s.chipText, { color: "#7dd3fc" }]}>End game</Text>
              </Pressable>
            </>
          )}

          {match.status === "LIVE" && (
            <View style={[s.row, s.footer]}>
              <Pressable onPress={() => send({ action: "undo" })} disabled={busy} style={[s.chipBtn, { flex: 1 }]}>
                <Undo2 size={15} color={colors.zinc300} />
                <Text style={s.chipText}>Undo</Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  Alert.alert("End match?", "This submits the current score as the final result.", [
                    { text: "Cancel", style: "cancel" },
                    { text: "End match", style: "destructive", onPress: () => void end() },
                  ])
                }
                disabled={busy}
                style={[s.chipBtn, s.endBtn, { flex: 1 }]}
              >
                <Text style={[s.chipText, { color: "#f87171" }]}>End match</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>

        {busy && (
          <View style={s.busyBar}>
            <ActivityIndicator size="small" color={colors.emerald400} />
          </View>
        )}
      </View>

      {/* ══ Player sheet — opens itself when a batter/bowler is needed ══ */}
      {/* ── How did they get out? ────────────────────────────────────
          Bowled/caught/lbw/stumped always take the striker. A run-out can
          take either batter and often follows a run that already crossed
          them, so that one asks rather than guessing from an end. */}
      <Modal
        visible={wicketSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setWicketSheet(false)}
      >
        <Pressable style={s.sheetBackdrop} onPress={() => setWicketSheet(false)}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>How was the wicket?</Text>
              <Pressable onPress={() => setWicketSheet(false)} hitSlop={10}>
                <X size={20} color={colors.zinc400} />
              </Pressable>
            </View>
            <ScrollView>
              {(
                [
                  ["bowled", "Bowled"],
                  ["caught", "Caught"],
                  ["lbw", "LBW"],
                  ["stumped", "Stumped"],
                  ["hitwicket", "Hit wicket"],
                  ["runout", "Run out"],
                ] as const
              ).map(([kind, label]) => (
                <Pressable
                  key={kind}
                  style={s.sheetRow}
                  onPress={() => {
                    setWicketSheet(false);
                    // A run-out can take either batter; a catch or stumping
                    // belongs to a fielder. Both ask, in that order.
                    if (kind === "runout") setOutBatterFor(kind);
                    else if (kind === "caught" || kind === "stumped") {
                      setFielderFor({ dismissal: kind });
                    } else {
                      void ball({ runs: 0, wicket: true, dismissal: kind });
                    }
                  }}
                >
                  <Text style={s.sheetRowText}>{label}</Text>
                  <Text style={s.sheetRowMeta}>
                    {kind === "runout" ? "either batter" : nameOf(strikerId) || "striker"}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Run out: which batter went? ─────────────────────────────
          Only a run-out can take the batter at the other end, so this is
          the one dismissal that has to ask. */}
      <Modal
        visible={!!outBatterFor}
        transparent
        animationType="slide"
        onRequestClose={() => setOutBatterFor(null)}
      >
        <Pressable style={s.sheetBackdrop} onPress={() => setOutBatterFor(null)}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>Who was run out?</Text>
              <Pressable onPress={() => setOutBatterFor(null)} hitSlop={10}>
                <X size={20} color={colors.zinc400} />
              </Pressable>
            </View>
            <ScrollView>
              {[strikerId, nonStrikerId]
                .filter((id): id is string => !!id)
                .map((id) => (
                  <Pressable
                    key={id}
                    style={s.sheetRow}
                    onPress={() => {
                      setOutBatterFor(null);
                      setFielderFor({ dismissal: "runout", outBatterId: id });
                    }}
                  >
                    <Text style={s.sheetRowText}>{nameOf(id)}</Text>
                    <Text style={s.sheetRowMeta}>
                      {id === strikerId ? "on strike" : "non-striker"}
                    </Text>
                  </Pressable>
                ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Who did it? ──────────────────────────────────────────────
          Step two of a catch, stumping or run-out. Skippable on purpose: a
          scorer who genuinely didn't see it must still be able to log the
          wicket, and the card then reads "caught" rather than naming the
          wrong player. */}
      <Modal
        visible={!!fielderFor}
        transparent
        animationType="slide"
        onRequestClose={() => setFielderFor(null)}
      >
        <Pressable style={s.sheetBackdrop} onPress={() => setFielderFor(null)}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={s.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={s.sheetTitle}>
                  {fielderFor?.dismissal === "caught"
                    ? "Who took the catch?"
                    : fielderFor?.dismissal === "stumped"
                      ? "Who stumped them?"
                      : "Who ran them out?"}
                </Text>
                <Text style={s.sheetRowMeta}>
                  {nameOf(fielderFor?.outBatterId || strikerId) || "Batter"} is out
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  const draft = fielderFor;
                  setFielderFor(null);
                  if (draft) void ball({ runs: 0, wicket: true, ...draft });
                }}
                hitSlop={10}
              >
                <Text style={s.sheetSkip}>Skip</Text>
              </Pressable>
            </View>
            <ScrollView>
              {fielding.members.map((p) => (
                <Pressable
                  key={p.id}
                  style={s.sheetRow}
                  onPress={() => {
                    const draft = fielderFor;
                    setFielderFor(null);
                    if (draft) {
                      void ball({ runs: 0, wicket: true, ...draft, fielderId: p.id });
                    }
                  }}
                >
                  <Text style={s.sheetRowText}>{p.name}</Text>
                  {p.id === bowlerId && (
                    <Text style={s.sheetRowMeta}>
                      {fielderFor?.dismissal === "caught" ? "c & b" : "bowler"}
                    </Text>
                  )}
                </Pressable>
              ))}
              {fielding.members.length === 0 && (
                <Text style={s.sheetEmpty}>
                  No players listed for {fielding.name}. Tap Skip to log the
                  wicket without a fielder.
                </Text>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Retired hurt ─────────────────────────────────────────────
          No ball logged, no wicket, and they stay eligible to return. */}
      <Modal
        visible={retireSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setRetireSheet(false)}
      >
        <Pressable style={s.sheetBackdrop} onPress={() => setRetireSheet(false)}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>Who is retiring hurt?</Text>
              <Pressable onPress={() => setRetireSheet(false)} hitSlop={10}>
                <X size={20} color={colors.zinc400} />
              </Pressable>
            </View>
            {[strikerId, nonStrikerId]
              .filter((id): id is string => !!id)
              .map((id) => (
                <Pressable
                  key={id}
                  style={s.sheetRow}
                  onPress={() => {
                    setRetireSheet(false);
                    void ev("RETIRE", { memberId: id, data: { batterId: id } });
                  }}
                >
                  <Text style={s.sheetRowText}>{nameOf(id)}</Text>
                  <Text style={s.sheetRowMeta}>
                    {id === strikerId ? "on strike" : "non-striker"}
                  </Text>
                </Pressable>
              ))}
            <Text style={s.sheetHint}>
              No wicket is recorded and they can bat again later in the innings.
            </Text>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!picker} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <Pressable style={s.sheetBackdrop} onPress={() => setPicker(null)}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>
                {picker === "striker"
                  ? needsBatter
                    ? "Wicket — who's in?"
                    : "Striker"
                  : picker === "nonStriker"
                    ? "Non-striker"
                    : picker === "bowler"
                      ? needsBowler
                        ? "Over complete — next bowler"
                        : "Bowler"
                      : "Goal scorer"}
              </Text>
              <Pressable onPress={() => setPicker(null)} hitSlop={10}>
                <X size={20} color={colors.zinc400} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 380 }}>
              {(pickerTeam ? pickerTeam.members : allPlayers).map((p) => {
                const on = p.id === pickerValue;
                // Mirror of the server's rules (validateLiveEvent) so the
                // scorer sees them before tapping: a dismissed batter can't
                // come back in, and a bowler can neither exceed the quota
                // nor bowl two overs in a row.
                const spellBalls = liveCur?.spells.find((sp) => sp.id === p.id)?.balls ?? 0;
                const startingOver = (liveCur?.thisOver.length ?? 0) === 0;
                const blocked =
                  picker === "striker" || picker === "nonStriker"
                    ? liveCur?.dismissed.includes(p.id)
                      ? "out"
                      : null
                    : picker === "bowler"
                      ? startingOver && liveCur?.lastOverBowlerId === p.id
                        ? "bowled last over"
                        : maxOvers > 0 && spellBalls >= maxOvers * 6
                          ? `${maxOvers} ov bowled`
                          : null
                      : null;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => !blocked && applyPick(p.id)}
                    disabled={!!blocked}
                    style={[s.sheetRow, on && !blocked && s.sheetRowOn, !!blocked && { opacity: 0.4 }]}
                  >
                    <Text style={[s.sheetName, on && !blocked && { color: colors.emerald400, fontWeight: "700" }]}>
                      {p.name}
                    </Text>
                    {blocked ? (
                      <Text style={s.blockedTag}>{blocked}</Text>
                    ) : picker === "bowler" ? (
                      <Text style={s.creaseFigs}>
                        {Math.floor(spellBalls / 6)}.{spellBalls % 6} ov
                        {maxOvers > 0 ? ` / ${maxOvers}` : ""}
                      </Text>
                    ) : (
                      figs(p.id) && (
                        <Text style={s.creaseFigs}>
                          {figs(p.id)!.runs} ({figs(p.id)!.balls})
                        </Text>
                      )
                    )}
                  </Pressable>
                );
              })}
              {(pickerTeam ? pickerTeam.members : allPlayers).length === 0 && (
                <Text style={[s.dim, { padding: 16, paddingBottom: 4 }]}>
                  No squad entered for this team — add players as they come in.
                </Text>
              )}
              {/* Always available, not just when the squad is empty: a
                  substitute turns up, or a name is spelled differently on
                  the day, and neither should send the scorer to a laptop
                  mid-over. */}
              {pickerTeam ? (
                <View style={s.addRow}>
                  <TextInput
                    style={s.addInput}
                    placeholder="Add a player…"
                    placeholderTextColor={colors.zinc600}
                    value={newName}
                    onChangeText={setNewName}
                    autoCapitalize="words"
                    returnKeyType="done"
                    onSubmitEditing={submitNewPlayer}
                    editable={!adding}
                  />
                  <Pressable
                    onPress={submitNewPlayer}
                    disabled={adding || !newName.trim()}
                    style={[s.addBtn, (adding || !newName.trim()) && { opacity: 0.4 }]}
                  >
                    <Text style={s.addBtnText}>{adding ? "Adding…" : "Add"}</Text>
                  </Pressable>
                </View>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.zinc800,
  },
  addInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.zinc700,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: colors.foreground,
    fontSize: 14,
  },
  addBtn: {
    borderWidth: 1,
    borderColor: "rgba(52, 211, 153, 0.4)",
    backgroundColor: "rgba(52, 211, 153, 0.12)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  addBtnText: { color: colors.emerald400, fontSize: 13, fontWeight: "700" },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  bigMsg: { color: colors.foreground, fontSize: 18, fontWeight: "700" },
  dim: { color: colors.zinc500, fontSize: 13 },
  kicker: { color: colors.emerald500, fontSize: 11, letterSpacing: 1, fontWeight: "700" },
  h1: { color: colors.foreground, fontSize: 20, fontWeight: "800" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },

  // Match picker
  pickerList: { padding: 16, gap: 10 },
  matchCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 14,
  },
  matchLabel: { color: colors.zinc500, fontSize: 12, flex: 1, textAlign: "center" },
  matchTeams: { color: colors.foreground, fontSize: 15, fontWeight: "600", marginTop: 3 },

  // Pinned scoreboard — a card, not a full-bleed bar.
  board: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    marginHorizontal: 12,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
  },
  boardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  backRow: { flexDirection: "row", alignItems: "center", gap: 1 },
  backText: { color: colors.zinc400, fontSize: 13 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  liveText: { color: "#f87171", fontSize: 11, fontWeight: "800" },
  scoreLine: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginTop: 6 },
  scoreLineTwo: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  battingTeam: { color: colors.zinc300, fontSize: 15, fontWeight: "600", flexShrink: 1 },
  extraRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  extraLabel: {
    color: colors.zinc500,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    width: 62,
  },
  extraOpts: { flexDirection: "row", flexWrap: "wrap", gap: 6, flex: 1 },
  extraChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  sheetSkip: { color: colors.zinc400, fontSize: 14, fontWeight: "600" },
  sheetEmpty: { color: colors.zinc500, fontSize: 13, paddingHorizontal: 20, paddingVertical: 24 },
  teamSmall: { color: colors.zinc400, fontSize: 12 },
  // lineHeight matters: without it RN clips tall digits at these sizes.
  scoreBig: { color: colors.emerald400, fontSize: 30, lineHeight: 38, fontWeight: "800" },
  scoreOvers: { color: colors.zinc500, fontSize: 14, lineHeight: 20, fontWeight: "500" },
  target: { color: "#fbbf24", fontSize: 12, marginTop: 2 },

  crease: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 6,
    gap: 2,
  },
  creaseRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8, paddingVertical: 3 },
  creaseName: { color: colors.zinc300, fontSize: 14, flex: 1 },
  creaseOnStrike: { color: colors.foreground, fontWeight: "700" },
  creaseFigs: { color: colors.zinc400, fontSize: 13, fontVariant: ["tabular-nums"] },
  creaseBowler: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 3, paddingTop: 6 },
  overRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6, gap: 8 },
  overStrip: { flexDirection: "row", alignItems: "center", gap: 4, flex: 1, flexWrap: "wrap" },
  overEmpty: { color: colors.zinc600, fontSize: 11 },
  overBall: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 5,
    borderRadius: 12,
    backgroundColor: colors.zinc800,
    alignItems: "center",
    justifyContent: "center",
  },
  overBallW: { backgroundColor: "rgba(248,113,113,0.22)" },
  overBallB: { backgroundColor: "rgba(16,185,129,0.22)" },
  // Centred in a 24px circle — same recipe as padText. 13 would be 1.18x,
  // right on the clamp threshold, so give it real headroom.
  overBallText: {
    color: colors.zinc300,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    textAlign: "center",
    includeFontPadding: false,
  },
  swap: { color: colors.zinc400, fontSize: 12 },

  error: { color: "#f87171", fontSize: 13, textAlign: "center", paddingHorizontal: 16, paddingTop: 8 },

  // Controls
  controls: { padding: 14, gap: 10, paddingBottom: 28 },
  row: { flexDirection: "row", gap: 10 },
  // Fixed-height keys in explicit rows — NOT width% + aspectRatio, so the
  // key's box is a number we chose rather than one the layout derives.
  doneBanner: {
    borderWidth: 1,
    borderColor: "rgba(125,211,252,0.45)",
    backgroundColor: "rgba(125,211,252,0.10)",
    borderRadius: radius.xl,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  doneBannerText: { color: "#7dd3fc", fontSize: 13, fontWeight: "600", textAlign: "center" },
  needBanner: {
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.45)",
    backgroundColor: "rgba(251,191,36,0.10)",
    borderRadius: radius.xl,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  needBannerText: { color: "#fbbf24", fontSize: 13, fontWeight: "600", textAlign: "center" },
  padRow: { flexDirection: "row", gap: 10 },
  padSpacer: { flex: 1 },
  key: {
    flex: 1,
    height: 78,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.cardElevated,
  },
  keyBoundary: { borderColor: colors.emerald500_30, backgroundColor: colors.emerald500_10 },
  keyWicket: { borderColor: "rgba(248,113,113,0.45)", backgroundColor: "rgba(248,113,113,0.12)" },
  keyExtra: { borderColor: "rgba(251,191,36,0.45)", backgroundColor: "rgba(251,191,36,0.10)" },
  keyInfo: { borderColor: "rgba(125,211,252,0.45)", backgroundColor: "rgba(125,211,252,0.10)" },
  keyPressed: { opacity: 0.6 },
  keyBusy: { opacity: 0.45 },
  // height === lineHeight, so this Text is exactly one line box and
  // textAlignVertical decides where the glyph sits inside it. Nothing here
  // depends on the font's own ascent/descent, which is what the three
  // previous lineHeight-tuning attempts kept getting wrong on Android.
  keyGlyph: {
    height: 34,
    lineHeight: 34,
    fontSize: 25,
    fontWeight: "800",
    textAlign: "center",
    textAlignVertical: "center",
    includeFontPadding: false,
  },
  /** Two-character glyphs (Wd/Nb) shrink the font but KEEP the 34px box, so
   *  every caption in a row still sits on the same line. */
  keyGlyphSm: { fontSize: 19 },
  keyCaption: {
    height: 13,
    lineHeight: 13,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.7,
    color: colors.zinc500,
    textAlign: "center",
    textAlignVertical: "center",
    includeFontPadding: false,
    opacity: 0.85,
  },
  blockedTag: {
    color: colors.zinc400,
    fontSize: 11,
    backgroundColor: colors.zinc800,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: "hidden",
  },

  wideBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingVertical: 16,
  },
  greenBtn: { borderColor: colors.emerald500_30, backgroundColor: colors.emerald500_10 },
  greenText: { color: colors.emerald400, fontSize: 15, fontWeight: "700" },
  amberBtn: { borderColor: "rgba(251,191,36,0.4)", backgroundColor: "rgba(251,191,36,0.12)" },
  amberText: { color: "#fbbf24", fontSize: 15, fontWeight: "700" },
  blueBtn: { borderColor: "rgba(125,211,252,0.4)", backgroundColor: "rgba(125,211,252,0.10)" },
  blueText: { color: "#7dd3fc", fontSize: 13, fontWeight: "700", textAlign: "center" },

  chipBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: 13,
    paddingHorizontal: 10,
  },
  chipText: { color: colors.zinc300, fontSize: 13, fontWeight: "600" },
  endBtn: { borderColor: "rgba(248,113,113,0.4)" },
  footer: { marginTop: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },

  goalBtn: {
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_10,
    paddingVertical: 18,
  },
  goalText: { color: colors.emerald400, fontSize: 13, fontWeight: "700" },
  plusOne: { color: colors.emerald400, fontSize: 26, lineHeight: 32, fontWeight: "800" },
  scorerRow: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
  },
  scorerLabel: { color: colors.zinc500, fontSize: 11 },
  scorerValue: { color: colors.foreground, fontSize: 14, marginTop: 2 },
  lastGoal: { color: colors.zinc500, fontSize: 12, textAlign: "center" },

  busyBar: { position: "absolute", top: 0, left: 0, right: 0, alignItems: "center", paddingTop: 4 },

  // Player sheet
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: {
    // A ScrollView only scrolls inside a bounded parent. Unbounded, a long
    // sheet simply runs off the bottom of the screen and the rows below
    // are unreachable -- which is exactly how the run-out options got lost.
    maxHeight: "80%",
    backgroundColor: colors.cardElevated,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetTitle: { color: colors.foreground, fontSize: 16, fontWeight: "700" },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 15,
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(38,38,38,0.6)",
  },
  sheetRowOn: { backgroundColor: colors.emerald500_10 },
  sheetName: { color: colors.zinc300, fontSize: 15 },
  sheetRowText: { color: colors.zinc300, fontSize: 15 },
  sheetRowMeta: { color: colors.zinc500, fontSize: 12 },
  sheetSection: {
    color: colors.zinc500,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 4,
  },
  sheetHint: {
    color: colors.zinc500,
    fontSize: 11,
    paddingHorizontal: 18,
    paddingTop: 12,
  },
  // Toss-time overs, above Start Match.
  oversBox: {
    borderWidth: 1,
    borderColor: colors.zinc700,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 10,
  },
  oversLabel: { color: colors.zinc400, fontSize: 12, fontWeight: "600" },
  oversInput: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: colors.zinc700,
    borderRadius: radius.md,
    backgroundColor: colors.zinc800_50,
    color: colors.foreground,
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
    paddingVertical: 10,
  },
  oversHint: { color: colors.zinc500, fontSize: 11, marginTop: 6 },
});
