import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ChevronLeft, Play, Radio, Square, Undo2 } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { colors, radius } from "../../theme";
import {
  fetchScorerBoot,
  sendScorerAction,
  type ScorerBoot,
  type ScorerMatch,
  type ScorerTeam,
} from "../../lib/tournaments";
import type { RootStackParamList } from "../../navigation/types";

// Native twin of the web scorer console (app/score/[code]). Same routes,
// same rules — the code in the route params is the credential.

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Rt = RouteProp<RootStackParamList, "ScorerConsole">;

type CricketState = {
  inning: number;
  battingTeamId: string | null;
  innings: { teamId: string; runs: number; wickets: number; balls: number }[];
  target: number | null;
};
type PickleState = {
  current: { home: number; away: number };
  gamesWon: { home: number; away: number };
};

const overs = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`;

function clockDisplay(m: ScorerMatch): string {
  const base =
    m.clockElapsedSec +
    (m.clockStartedAt ? Math.max(0, Math.round((Date.now() - new Date(m.clockStartedAt).getTime()) / 1000)) : 0);
  return `${Math.floor(base / 60)}:${String(base % 60).padStart(2, "0")}`;
}

/** Compact player picker — a row of chips beats a native picker when the
 *  scorer is tapping between deliveries with one hand. */
function PlayerChips({
  label,
  team,
  value,
  onChange,
  emptyHint,
}: {
  label: string;
  team: ScorerTeam;
  value: string;
  onChange: (id: string) => void;
  emptyHint?: string;
}) {
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={styles.pickerLabel}>{label}</Text>
      {team.members.length === 0 ? (
        <Text style={styles.hint}>{emptyHint || "No players in this squad yet."}</Text>
      ) : (
        <View style={styles.chipWrap}>
          {team.members.map((p) => {
            const on = p.id === value;
            return (
              <Pressable
                key={p.id}
                onPress={() => onChange(on ? "" : p.id)}
                style={[styles.playerChip, on && styles.playerChipOn]}
              >
                <Text style={[styles.playerChipText, on && { color: colors.emerald400, fontWeight: "700" }]}>
                  {p.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
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

  // Striker / non-striker / bowler — every ball is tagged to them, which
  // is what builds the batting and bowling cards on the match centre.
  const [strikerId, setStrikerId] = useState("");
  const [nonStrikerId, setNonStrikerId] = useState("");
  const [bowlerId, setBowlerId] = useState("");

  const refresh = useCallback(async () => {
    try {
      setBoot(await fetchScorerBoot(code));
      setInvalid(false);
    } catch (e) {
      // Only a genuinely bad code kills the screen; a blip keeps the pad up.
      if (e instanceof Error && /404|invalid/i.test(e.message) && !boot) setInvalid(true);
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

  const send = async (payload: Record<string, unknown>, opts?: { silent?: boolean }) => {
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
      else if (!opts?.silent) setError(msg);
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
    setStrikerId("");
    setNonStrikerId("");
    setBowlerId("");
  };

  const swapStrike = () => {
    setStrikerId((s) => {
      setNonStrikerId(s);
      return nonStrikerId;
    });
  };

  /** One delivery, attributed to the selected striker + bowler. Strike
   *  rotates on odd runs, exactly as it does on the field. */
  const ball = async (data: { runs: number; extra?: string; wicket?: boolean }) => {
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
    if (!data.extra && data.runs % 2 === 1 && nonStrikerId) swapStrike();
  };

  // ── States ──
  if (invalid) {
    return (
      <Screen>
        <View style={styles.centre}>
          <Text style={styles.bigMsg}>Invalid scorer code</Text>
          <Text style={styles.sub}>Check the code with the tournament admin.</Text>
          <Pressable onPress={() => navigation.goBack()} style={styles.primaryBtn}>
            <Text style={styles.primaryText}>Back</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }
  if (!boot) {
    return (
      <Screen>
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.emerald400} />
        </View>
      </Screen>
    );
  }

  // ── Match picker ──
  if (!match) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.kicker}>SCORER CONSOLE</Text>
          <Text style={styles.h1}>{boot.tournament.name}</Text>
          <Text style={styles.sub}>Pick a match to score.</Text>
          {boot.matches.map((m) => (
            <Pressable
              key={m.id}
              onPress={() => {
                resetPlayers();
                setMatchId(m.id);
              }}
              style={styles.matchCard}
            >
              <View style={styles.rowBetween}>
                <Text style={styles.matchLabel}>{m.roundLabel}</Text>
                {m.status === "LIVE" && (
                  <View style={styles.liveRow}>
                    <Radio size={11} color="#f87171" />
                    <Text style={styles.liveText}>LIVE</Text>
                  </View>
                )}
              </View>
              <Text style={styles.matchTeams}>
                {m.homeTeam.name} <Text style={{ color: colors.zinc600 }}>vs</Text> {m.awayTeam.name}
              </Text>
              {m.scheduledAt && (
                <Text style={styles.matchWhen}>
                  {new Date(m.scheduledAt).toLocaleString("en-IN", {
                    weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata",
                  })}
                </Text>
              )}
            </Pressable>
          ))}
          {boot.matches.length === 0 && (
            <View style={styles.matchCard}>
              <Text style={styles.sub}>No scoreable matches right now.</Text>
            </View>
          )}
        </ScrollView>
      </Screen>
    );
  }

  // ── Scoring pad ──
  const sport = boot.tournament.sport;
  const cs = (match.liveState || null) as CricketState | null;
  const ps = (match.liveState || null) as PickleState | null;
  const batting =
    cs?.battingTeamId === match.awayTeam.id ? match.awayTeam : match.homeTeam;
  const bowling = batting.id === match.homeTeam.id ? match.awayTeam : match.homeTeam;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.rowBetween}>
          <Pressable onPress={() => setMatchId(null)} style={styles.backRow}>
            <ChevronLeft size={18} color={colors.zinc400} />
            <Text style={{ color: colors.zinc400, fontSize: 14 }}>Matches</Text>
          </Pressable>
          {match.status === "LIVE" && (
            <View style={styles.liveRow}>
              <Radio size={12} color="#f87171" />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          )}
        </View>

        {/* Scoreboard */}
        <View style={styles.board}>
          <Text style={styles.matchLabel}>{match.roundLabel}</Text>
          <View style={styles.boardRow}>
            {[match.homeTeam, match.awayTeam].map((team, i) => (
              <View key={team.id} style={{ flex: 1, alignItems: "center" }}>
                <View style={[styles.dot, { backgroundColor: team.color || colors.zinc700 }]} />
                <Text style={styles.boardTeam} numberOfLines={1}>{team.name}</Text>
                <Text style={styles.boardScore}>
                  {(i === 0 ? match.homeScore : match.awayScore) ?? 0}
                </Text>
              </View>
            ))}
          </View>
          {sport === "FOOTBALL" && (
            <Text style={[styles.clock, match.clockStartedAt && { color: colors.emerald400 }]}>
              {clockDisplay(match)}
            </Text>
          )}
          {sport === "CRICKET" && cs && cs.inning > 0 && (
            <Text style={styles.boardSub}>
              {cs.innings.map((inn, i) => {
                const t = inn.teamId === match.homeTeam.id ? match.homeTeam : match.awayTeam;
                return `${i > 0 ? " · " : ""}${t.name}: ${inn.runs}/${inn.wickets} (${overs(inn.balls)})`;
              })}
              {cs.target != null ? `  Target ${cs.target}` : ""}
            </Text>
          )}
          {sport === "PICKLEBALL" && ps && (
            <Text style={styles.boardSub}>
              Games {ps.gamesWon.home}–{ps.gamesWon.away} · Current {ps.current.home}–{ps.current.away}
            </Text>
          )}
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        {match.status === "SCHEDULED" && (
          <Pressable onPress={() => send({ action: "start" })} disabled={busy} style={[styles.bigBtn, styles.startBtn]}>
            <Play size={18} color={colors.emerald400} />
            <Text style={styles.startText}>Start Match</Text>
          </Pressable>
        )}

        {match.status === "LIVE" && (
          <>
            {/* ── CRICKET ── */}
            {sport === "CRICKET" && (
              <>
                {!cs || cs.inning === 0 ? (
                  <View style={styles.grid2}>
                    {[match.homeTeam, match.awayTeam].map((team) => (
                      <Pressable
                        key={team.id}
                        onPress={() => {
                          resetPlayers();
                          ev("INNINGS_START", { teamId: team.id });
                        }}
                        disabled={busy}
                        style={[styles.bigBtn, styles.blueBtn, { flex: 1 }]}
                      >
                        <Text style={styles.blueText}>{team.name} bat first</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <>
                    <View style={styles.pickerCard}>
                      <PlayerChips label="Striker" team={batting} value={strikerId} onChange={setStrikerId} />
                      <PlayerChips label="Non-striker" team={batting} value={nonStrikerId} onChange={setNonStrikerId} />
                      <PlayerChips label={`Bowler (${bowling.name})`} team={bowling} value={bowlerId} onChange={setBowlerId} />
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}>
                        <Pressable
                          onPress={swapStrike}
                          disabled={!nonStrikerId}
                          style={[styles.smallBtn, !nonStrikerId && { opacity: 0.4 }]}
                        >
                          <Text style={styles.smallBtnText}>⇄ Swap strike</Text>
                        </Pressable>
                        {!strikerId && (
                          <Text style={styles.hintAmber}>Pick a striker to build the batting card.</Text>
                        )}
                      </View>
                    </View>

                    <View style={styles.padWrap}>
                      {[0, 1, 2, 3, 4, 6].map((r) => (
                        <Pressable
                          key={r}
                          onPress={() => ball({ runs: r })}
                          disabled={busy}
                          style={[styles.padBtn, (r === 4 || r === 6) && styles.padBtnBoundary]}
                        >
                          <Text style={[styles.padText, (r === 4 || r === 6) && { color: colors.emerald400 }]}>{r}</Text>
                        </Pressable>
                      ))}
                      <Pressable onPress={() => ball({ runs: 0, wicket: true })} disabled={busy} style={[styles.padBtn, styles.padBtnWicket]}>
                        <Text style={[styles.padText, { color: "#f87171" }]}>W</Text>
                      </Pressable>
                      <Pressable onPress={() => ball({ runs: 1, extra: "wd" })} disabled={busy} style={[styles.padBtn, styles.padBtnExtra]}>
                        <Text style={[styles.padText, { color: "#fbbf24", fontSize: 18 }]}>Wd</Text>
                      </Pressable>
                    </View>

                    <View style={styles.grid3}>
                      <Pressable onPress={() => ball({ runs: 1, extra: "nb" })} disabled={busy} style={[styles.smallBtn, { flex: 1 }]}>
                        <Text style={[styles.smallBtnText, { color: "#fbbf24" }]}>No Ball +1</Text>
                      </Pressable>
                      <Pressable onPress={() => ball({ runs: 1, extra: "b" })} disabled={busy} style={[styles.smallBtn, { flex: 1 }]}>
                        <Text style={styles.smallBtnText}>Bye +1</Text>
                      </Pressable>
                      {cs.inning === 1 && (
                        <Pressable
                          onPress={() => {
                            const other = cs.battingTeamId === match.homeTeam.id ? match.awayTeam.id : match.homeTeam.id;
                            resetPlayers(); // sides swap
                            ev("INNINGS_START", { teamId: other });
                          }}
                          disabled={busy}
                          style={[styles.smallBtn, { flex: 1, borderColor: colors.emerald500_30 }]}
                        >
                          <Text style={[styles.smallBtnText, { color: "#7dd3fc" }]}>End Innings</Text>
                        </Pressable>
                      )}
                    </View>
                  </>
                )}
              </>
            )}

            {/* ── FOOTBALL ── */}
            {sport === "FOOTBALL" && (
              <>
                <Pressable
                  onPress={() => ev(match.clockStartedAt ? "CLOCK_STOP" : "CLOCK_START")}
                  disabled={busy}
                  style={[styles.bigBtn, match.clockStartedAt ? styles.amberBtn : styles.startBtn]}
                >
                  {match.clockStartedAt ? <Square size={16} color="#fbbf24" /> : <Play size={16} color={colors.emerald400} />}
                  <Text style={match.clockStartedAt ? styles.amberText : styles.startText}>
                    {match.clockStartedAt ? "Stop Clock" : "Start Clock"}
                  </Text>
                </Pressable>

                <View style={styles.pickerCard}>
                  <Text style={styles.pickerLabel}>Goal scorer (optional)</Text>
                  <View style={styles.chipWrap}>
                    {[match.homeTeam, match.awayTeam].flatMap((t) =>
                      t.members.map((p) => {
                        const on = p.id === strikerId;
                        return (
                          <Pressable
                            key={p.id}
                            onPress={() => setStrikerId(on ? "" : p.id)}
                            style={[styles.playerChip, on && styles.playerChipOn]}
                          >
                            <Text style={[styles.playerChipText, on && { color: colors.emerald400, fontWeight: "700" }]}>
                              {p.name}
                            </Text>
                          </Pressable>
                        );
                      })
                    )}
                  </View>
                </View>

                <View style={styles.grid2}>
                  {[match.homeTeam, match.awayTeam].map((team) => (
                    <Pressable
                      key={team.id}
                      onPress={async () => {
                        const scorer = team.members.some((p) => p.id === strikerId) ? strikerId : "";
                        await send({
                          action: "event",
                          event: { kind: "GOAL", teamId: team.id, ...(scorer ? { memberId: scorer } : {}) },
                        });
                        setStrikerId("");
                      }}
                      disabled={busy}
                      style={[styles.bigBtn, styles.startBtn, { flex: 1, flexDirection: "column", gap: 2 }]}
                    >
                      <Text style={{ fontSize: 22 }}>⚽</Text>
                      <Text style={[styles.startText, { fontSize: 12 }]}>{team.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {/* ── PICKLEBALL ── */}
            {sport === "PICKLEBALL" && (
              <>
                <View style={styles.grid2}>
                  {[match.homeTeam, match.awayTeam].map((team) => (
                    <Pressable
                      key={team.id}
                      onPress={() => ev("POINT", { teamId: team.id })}
                      disabled={busy}
                      style={[styles.bigBtn, styles.startBtn, { flex: 1, flexDirection: "column", gap: 2 }]}
                    >
                      <Text style={{ fontSize: 22, color: colors.emerald400, fontWeight: "800" }}>+1</Text>
                      <Text style={[styles.startText, { fontSize: 12 }]}>{team.name}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable onPress={() => ev("GAME_END")} disabled={busy} style={[styles.smallBtn, { alignSelf: "stretch" }]}>
                  <Text style={[styles.smallBtnText, { color: "#7dd3fc" }]}>End Game</Text>
                </Pressable>
              </>
            )}

            {/* Undo + end */}
            <View style={[styles.grid2, styles.footer]}>
              <Pressable onPress={() => send({ action: "undo" })} disabled={busy} style={[styles.smallBtn, { flex: 1, paddingVertical: 14 }]}>
                <Undo2 size={15} color={colors.zinc300} />
                <Text style={styles.smallBtnText}>Undo</Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  Alert.alert("End match?", "This submits the current score as the final result.", [
                    { text: "Cancel", style: "cancel" },
                    { text: "End match", style: "destructive", onPress: () => void end() },
                  ])
                }
                disabled={busy}
                style={[styles.smallBtn, styles.endBtn, { flex: 1, paddingVertical: 14 }]}
              >
                <Text style={[styles.smallBtnText, { color: "#f87171" }]}>End Match</Text>
              </Pressable>
            </View>
          </>
        )}

        {busy && (
          <View style={{ alignItems: "center", paddingVertical: 6 }}>
            <ActivityIndicator size="small" color={colors.emerald400} />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  bigMsg: { color: colors.foreground, fontSize: 18, fontWeight: "700" },
  kicker: { color: colors.emerald500, fontSize: 11, letterSpacing: 1, fontWeight: "700" },
  h1: { color: colors.foreground, fontSize: 20, fontWeight: "800" },
  sub: { color: colors.zinc500, fontSize: 13, textAlign: "center" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  liveText: { color: "#f87171", fontSize: 11, fontWeight: "800" },
  matchCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 14,
  },
  matchLabel: { color: colors.zinc500, fontSize: 11 },
  matchTeams: { color: colors.foreground, fontSize: 15, fontWeight: "600", marginTop: 3 },
  matchWhen: { color: colors.zinc600, fontSize: 11, marginTop: 2 },
  board: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 14,
    alignItems: "center",
  },
  boardRow: { flexDirection: "row", alignItems: "center", marginTop: 8, alignSelf: "stretch" },
  dot: { width: 10, height: 10, borderRadius: 5, marginBottom: 5 },
  boardTeam: { color: colors.foreground, fontSize: 13, fontWeight: "600" },
  boardScore: { color: colors.emerald400, fontSize: 30, fontWeight: "800" },
  boardSub: { color: colors.zinc400, fontSize: 12, marginTop: 8, textAlign: "center" },
  clock: { color: colors.zinc500, fontSize: 18, marginTop: 6, fontVariant: ["tabular-nums"] },
  error: { color: "#f87171", fontSize: 13, textAlign: "center" },
  bigBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingVertical: 18,
  },
  startBtn: { borderColor: colors.emerald500_30, backgroundColor: colors.emerald500_10 },
  startText: { color: colors.emerald400, fontSize: 15, fontWeight: "700" },
  amberBtn: { borderColor: "rgba(251,191,36,0.4)", backgroundColor: "rgba(251,191,36,0.12)" },
  amberText: { color: "#fbbf24", fontSize: 15, fontWeight: "700" },
  blueBtn: { borderColor: "rgba(125,211,252,0.4)", backgroundColor: "rgba(125,211,252,0.10)" },
  blueText: { color: "#7dd3fc", fontSize: 13, fontWeight: "700", textAlign: "center" },
  grid2: { flexDirection: "row", gap: 10 },
  grid3: { flexDirection: "row", gap: 8 },
  pickerCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
  },
  pickerLabel: { color: colors.zinc500, fontSize: 11, marginBottom: 6 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  playerChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.zinc900,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  playerChipOn: { borderColor: colors.emerald500_30, backgroundColor: colors.emerald500_10 },
  playerChipText: { color: colors.zinc300, fontSize: 13 },
  hint: { color: colors.zinc600, fontSize: 12 },
  hintAmber: { color: "rgba(251,191,36,0.85)", fontSize: 11, flex: 1 },
  padWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  padBtn: {
    width: "23%",
    aspectRatio: 1.25,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
  },
  padBtnBoundary: { borderColor: colors.emerald500_30, backgroundColor: colors.emerald500_10 },
  padBtnWicket: { borderColor: "rgba(248,113,113,0.4)", backgroundColor: "rgba(248,113,113,0.12)" },
  padBtnExtra: { borderColor: "rgba(251,191,36,0.4)", backgroundColor: "rgba(251,191,36,0.10)" },
  padText: { color: colors.foreground, fontSize: 24, fontWeight: "800" },
  smallBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  smallBtnText: { color: colors.zinc300, fontSize: 13, fontWeight: "600" },
  endBtn: { borderColor: "rgba(248,113,113,0.4)" },
  footer: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14, marginTop: 4 },
  primaryBtn: {
    backgroundColor: colors.emerald500,
    borderRadius: radius.lg,
    paddingVertical: 13,
    paddingHorizontal: 24,
    marginTop: 8,
  },
  primaryText: { color: "#ffffff", fontWeight: "700", fontSize: 15 },
});
