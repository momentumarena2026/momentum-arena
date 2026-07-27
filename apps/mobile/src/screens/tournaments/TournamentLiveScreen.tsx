import { useEffect, useMemo, useState } from "react";
import { Image, ScrollView, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRoute, type RouteProp } from "@react-navigation/native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Radio, Trophy } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius } from "../../theme";
import { getLiveMatch, type TeamLite } from "../../lib/tournaments";
import type { AccountStackParamList } from "../../navigation/types";

type Rt = RouteProp<AccountStackParamList, "TournamentLive">;

type CricketState = {
  inning: number;
  innings: { teamId: string; runs: number; wickets: number; balls: number }[];
  target: number | null;
};
type PickleState = {
  games: { home: number; away: number }[];
  current: { home: number; away: number };
  gamesWon: { home: number; away: number };
};

const overs = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`;

function eventLine(
  e: { kind: string; teamId: string | null; data: Record<string, unknown> | null; member: { name: string } | null },
  teams: Map<string, string>
): string | null {
  const d = e.data || {};
  const team = e.teamId ? teams.get(e.teamId) || "" : "";
  switch (e.kind) {
    case "BALL": {
      const runs = Number(d.runs) || 0;
      if (d.wicket) return `🔴 WICKET!${e.member ? ` ${e.member.name}` : ""}`;
      if (d.extra === "wd") return "Wide +1";
      if (d.extra === "nb") return "No ball +1";
      if (runs === 4) return "🏏 FOUR!";
      if (runs === 6) return "💥 SIX!";
      return runs === 0 ? "Dot ball" : `${runs} run${runs > 1 ? "s" : ""}`;
    }
    case "INNINGS_START":
      return `🏏 ${team} start their innings`;
    case "GOAL":
      return `⚽ GOAL! ${team}${e.member ? ` — ${e.member.name}` : ""}`;
    case "CLOCK_START":
      return "▶ Clock started";
    case "CLOCK_STOP":
      return "⏸ Clock stopped";
    case "POINT":
      return `+1 point ${team}`;
    case "GAME_END":
      return "— Game over —";
    default:
      return null;
  }
}

function TeamCol({ team, score, note, big }: { team: TeamLite | null; score: number | null; note: string | null; big?: boolean }) {
  const size = big ? 56 : 44;
  return (
    <View style={{ alignItems: "center", gap: 6, flex: 1 }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: team?.color || colors.zinc700,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {team?.logoUrl ? (
          <Image source={{ uri: team.logoUrl }} style={{ width: size, height: size }} />
        ) : (
          <Text style={{ color: colors.foreground, fontWeight: "800", fontSize: size * 0.32 }}>
            {(team?.name || "?").slice(0, 2).toUpperCase()}
          </Text>
        )}
      </View>
      <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600", textAlign: "center" }} numberOfLines={1}>
        {team?.name || "TBD"}
      </Text>
      <Text style={{ color: colors.emerald400, fontSize: 40, fontWeight: "800" }}>{score ?? 0}</Text>
      {note ? <Text style={{ color: colors.zinc400, fontSize: 11 }}>{note}</Text> : null}
    </View>
  );
}

export function TournamentLiveScreen() {
  const route = useRoute<Rt>();
  const { matchId } = route.params;
  const [clock, setClock] = useState<number | null>(null);

  const { data } = useQuery({
    queryKey: ["live", matchId],
    queryFn: () => getLiveMatch(matchId),
    refetchInterval: 4000,
  });

  useEffect(() => {
    if (data?.match?.clockSeconds != null) setClock(data.match.clockSeconds);
  }, [data?.match?.clockSeconds]);

  useEffect(() => {
    const iv = setInterval(() => {
      setClock((c) => (c != null && data?.match?.clockRunning ? c + 1 : c));
    }, 1000);
    return () => clearInterval(iv);
  }, [data?.match?.clockRunning]);

  const teams = useMemo(() => {
    const m = new Map<string, string>();
    if (data?.match?.homeTeam) m.set(data.match.homeTeam.id, data.match.homeTeam.name);
    if (data?.match?.awayTeam) m.set(data.match.awayTeam.id, data.match.awayTeam.name);
    return m;
  }, [data]);

  if (!data) {
    return (
      <Screen>
        <View style={{ padding: 16, gap: 12 }}>
          <Skeleton height={220} />
          <Skeleton height={160} />
        </View>
      </Screen>
    );
  }

  if (data.gated) {
    return (
      <Screen>
        <View style={styles.gated}>
          <Text style={{ fontSize: 40 }}>📵</Text>
          <Text style={styles.gatedTitle}>Live screen unavailable</Text>
          <Text style={styles.gatedBody}>The organiser has turned the live screen off for now.</Text>
        </View>
      </Screen>
    );
  }

  const m = data.match!;
  const cs = data.tournament?.sport === "CRICKET" ? (m.liveState as CricketState | null) : null;
  const ps = data.tournament?.sport === "PICKLEBALL" ? (m.liveState as PickleState | null) : null;
  const clockStr = clock != null ? `${Math.floor(clock / 60)}:${String(clock % 60).padStart(2, "0")}` : null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Status */}
        <View style={styles.statusRow}>
          {m.status === "LIVE" ? (
            <View style={styles.liveChip}>
              <Radio size={12} color="#f87171" />
              <Text style={{ color: "#f87171", fontWeight: "800", fontSize: 12 }}>LIVE</Text>
            </View>
          ) : (
            <Text style={{ color: colors.zinc400, fontSize: 12 }}>
              {m.status === "COMPLETED" ? "Full Time" : m.status}
            </Text>
          )}
          <Text style={{ color: colors.zinc500, fontSize: 12 }} numberOfLines={1}>
            {data.tournament?.name} · {m.roundLabel}
          </Text>
        </View>

        {/* Scoreboard */}
        <Animated.View entering={FadeInDown} style={styles.board}>
          <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
            <TeamCol team={m.homeTeam} score={m.homeScore} note={m.homeScoreNote} big />
            <View style={{ width: 60, alignItems: "center", paddingTop: 30 }}>
              {clockStr ? (
                <Text
                  style={{
                    color: m.clockRunning ? colors.emerald400 : colors.zinc500,
                    fontSize: 20,
                    fontVariant: ["tabular-nums"],
                    fontWeight: "700",
                  }}
                >
                  {clockStr}
                </Text>
              ) : (
                <Text style={{ color: colors.zinc600, fontSize: 16 }}>vs</Text>
              )}
            </View>
            <TeamCol team={m.awayTeam} score={m.awayScore} note={m.awayScoreNote} big />
          </View>

          {cs && cs.inning > 0 && (
            <View style={styles.subStrip}>
              {cs.innings.map((inn, i) => (
                <Text key={i} style={{ color: i === cs.innings.length - 1 ? colors.foreground : colors.zinc400, fontSize: 12 }}>
                  {teams.get(inn.teamId)}: {inn.runs}/{inn.wickets} ({overs(inn.balls)})
                </Text>
              ))}
              {cs.target != null && m.status === "LIVE" && (
                <Text style={{ color: "#fbbf24", fontSize: 12 }}>Target {cs.target}</Text>
              )}
            </View>
          )}
          {ps && (
            <View style={styles.subStrip}>
              <Text style={{ color: colors.zinc300, fontSize: 12 }}>
                Games {ps.gamesWon.home}–{ps.gamesWon.away}
              </Text>
              {m.status === "LIVE" && (
                <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "700" }}>
                  Current {ps.current.home}–{ps.current.away}
                </Text>
              )}
            </View>
          )}

          {m.status === "COMPLETED" && (
            <View style={[styles.subStrip, { justifyContent: "center" }]}>
              <Trophy size={14} color={colors.emerald400} />
              <Text style={{ color: colors.emerald400, fontSize: 13, fontWeight: "700" }}>
                {m.isDraw ? "Match drawn" : m.winnerTeamId ? `${teams.get(m.winnerTeamId)} win!` : "Result recorded"}
              </Text>
              {m.playerOfMatch && (
                <Text style={{ color: "#fbbf24", fontSize: 12 }}>🏅 {m.playerOfMatch}</Text>
              )}
            </View>
          )}
        </Animated.View>

        {/* Feed */}
        {(data.events?.length || 0) > 0 && (
          <View style={styles.feed}>
            <Text style={styles.feedTitle}>Live feed</Text>
            {data.events!.map((e) => {
              const line = eventLine(e, teams);
              if (!line) return null;
              return (
                <View key={e.seq} style={styles.feedRow}>
                  <Text style={styles.feedTime}>
                    {new Date(e.createdAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}
                  </Text>
                  <Text style={styles.feedText}>{line}</Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 50 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  liveChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.4)",
    backgroundColor: "rgba(248,113,113,0.10)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  board: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 16,
  },
  subStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 12,
    paddingTop: 12,
    justifyContent: "center",
  },
  feed: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
  },
  feedTitle: { color: colors.zinc400, fontSize: 12, fontWeight: "700", textTransform: "uppercase", marginBottom: 8 },
  feedRow: { flexDirection: "row", gap: 8, paddingVertical: 4 },
  feedTime: { color: colors.zinc600, fontSize: 11, width: 56, textAlign: "right" },
  feedText: { color: colors.zinc300, fontSize: 13, flex: 1 },
  gated: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, gap: 8 },
  gatedTitle: { color: colors.foreground, fontSize: 18, fontWeight: "700" },
  gatedBody: { color: colors.zinc500, fontSize: 13, textAlign: "center" },
});
