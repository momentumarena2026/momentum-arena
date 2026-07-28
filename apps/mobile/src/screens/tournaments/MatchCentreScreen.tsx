import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { Radio, Trophy, MapPin, CalendarDays } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius } from "../../theme";
import { getMatchCentre, type InningsCard } from "../../lib/tournaments";
import type { AccountStackParamList } from "../../navigation/types";

// ESPNcricinfo-shaped match centre for the app: result header, then
// Scorecard / Commentary / Info. Live matches refetch on an interval.

type Rt = RouteProp<AccountStackParamList, "TournamentMatch">;
const TABS = ["Scorecard", "Commentary", "Info"] as const;
type Tab = (typeof TABS)[number];

function fmtWhen(iso: string | null): string {
  if (!iso) return "Time TBA";
  return new Date(iso).toLocaleString("en-IN", {
    weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata",
  });
}

function InningsBlock({ inn }: { inn: InningsCard }) {
  return (
    <View style={styles.card}>
      <View style={styles.inningsHead}>
        <Text style={styles.teamName}>{inn.teamName}</Text>
        <Text style={styles.inningsScore}>
          {inn.runs}/{inn.wickets}
          <Text style={styles.muted}> ({inn.overs} ov, RR {inn.runRate})</Text>
        </Text>
      </View>

      {inn.batting.length > 0 ? (
        <>
          <View style={[styles.row, styles.headRow]}>
            <Text style={[styles.hCell, { flex: 1, textAlign: "left" }]}>Batting</Text>
            <Text style={styles.hCell}>R</Text>
            <Text style={styles.hCell}>B</Text>
            <Text style={styles.hCell}>4s</Text>
            <Text style={styles.hCell}>6s</Text>
            <Text style={[styles.hCell, { width: 52 }]}>SR</Text>
          </View>
          {inn.batting.map((b) => (
            <View key={b.memberId} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.playerName}>{b.name}</Text>
                <Text style={styles.dismissal}>{b.out ? b.dismissal || "out" : "not out"}</Text>
              </View>
              <Text style={[styles.cell, styles.strong]}>{b.runs}</Text>
              <Text style={styles.cell}>{b.balls}</Text>
              <Text style={styles.cell}>{b.fours}</Text>
              <Text style={styles.cell}>{b.sixes}</Text>
              <Text style={[styles.cell, { width: 52 }]}>{b.strikeRate}</Text>
            </View>
          ))}
          <View style={styles.row}>
            <Text style={[styles.playerName, { flex: 1, color: colors.zinc400 }]}>Extras</Text>
            <Text style={styles.cell}>{inn.extras}</Text>
          </View>
        </>
      ) : (
        <Text style={styles.empty}>Ball-by-ball player detail wasn&apos;t recorded.</Text>
      )}

      {inn.bowling.length > 0 && (
        <>
          <View style={[styles.row, styles.headRow, { marginTop: 8 }]}>
            <Text style={[styles.hCell, { flex: 1, textAlign: "left" }]}>Bowling</Text>
            <Text style={[styles.hCell, { width: 44 }]}>O</Text>
            <Text style={styles.hCell}>R</Text>
            <Text style={styles.hCell}>W</Text>
            <Text style={[styles.hCell, { width: 52 }]}>Econ</Text>
          </View>
          {inn.bowling.map((b) => (
            <View key={b.memberId} style={styles.row}>
              <Text style={[styles.playerName, { flex: 1 }]}>{b.name}</Text>
              <Text style={[styles.cell, { width: 44 }]}>{b.overs}</Text>
              <Text style={styles.cell}>{b.runs}</Text>
              <Text style={[styles.cell, styles.strong]}>{b.wickets}</Text>
              <Text style={[styles.cell, { width: 52 }]}>{b.economy}</Text>
            </View>
          ))}
        </>
      )}

      {inn.fallOfWickets.length > 0 && (
        <Text style={styles.fow}>
          <Text style={{ color: colors.zinc600 }}>Fall of wickets: </Text>
          {inn.fallOfWickets
            .map((f) => (f.batter ? `${f.runs}-${f.wicket} (${f.batter}, ${f.over})` : `${f.runs}-${f.wicket} (${f.over})`))
            .join(" · ")}
        </Text>
      )}
    </View>
  );
}

export function MatchCentreScreen() {
  const { matchId } = useRoute<Rt>().params;
  const [tab, setTab] = useState<Tab>("Scorecard");

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["match-centre", matchId],
    queryFn: () => getMatchCentre(matchId),
    refetchInterval: (q) => (q.state.data?.match.status === "LIVE" ? 5000 : false),
  });

  if (isLoading || !data) {
    return (
      <Screen>
        <View style={{ padding: 16, gap: 12 }}>
          <Skeleton height={140} />
          <Skeleton height={240} />
        </View>
      </Screen>
    );
  }

  const m = data.match;
  const isLive = m.status === "LIVE";
  const isCricket = m.sport === "CRICKET";
  const noBallByBall = data.innings.every((i) => i.batting.length === 0);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.emerald400} />}
      >
        {/* Header */}
        <View style={styles.card}>
          <View style={styles.headerTop}>
            <Text style={styles.crumb} numberOfLines={1}>
              {data.tournament.name} · {m.roundLabel || m.stage}
            </Text>
            {isLive ? (
              <View style={styles.livePill}>
                <Radio size={11} color="#f87171" />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            ) : (
              <Text style={styles.statusPill}>
                {m.status === "COMPLETED" ? "Result" : m.status === "SCHEDULED" ? "Upcoming" : m.status}
              </Text>
            )}
          </View>

          {[
            { team: m.homeTeam, score: m.homeScore, note: m.homeScoreNote },
            { team: m.awayTeam, score: m.awayScore, note: m.awayScoreNote },
          ].map((side, i) => {
            const won = m.winnerTeamId && side.team?.id === m.winnerTeamId;
            const inn = data.innings.find((x) => x.teamId === side.team?.id);
            return (
              <View key={i} style={styles.sideRow}>
                <View
                  style={[styles.dot, { backgroundColor: side.team?.color || colors.zinc700 }]}
                />
                <Text style={[styles.sideName, won && styles.strongWhite]} numberOfLines={1}>
                  {side.team?.name || "TBD"}
                </Text>
                <Text style={[styles.sideScore, won && { color: colors.emerald400 }]}>
                  {side.note || (inn ? `${inn.runs}/${inn.wickets}` : side.score ?? "—")}
                  {isCricket && inn && !side.note && (
                    <Text style={styles.muted}> ({inn.overs})</Text>
                  )}
                </Text>
              </View>
            );
          })}

          <Text style={[styles.result, { color: isLive ? "#fbbf24" : colors.emerald400 }]}>
            {m.resultText}
          </Text>
          {m.playerOfMatch && (
            <View style={styles.potmRow}>
              <Trophy size={12} color="#fbbf24" />
              <Text style={styles.potm}>Player of the Match: {m.playerOfMatch}</Text>
            </View>
          )}
        </View>

        {/* Tabs */}
        <View style={styles.tabs}>
          {TABS.map((x) => (
            <Pressable key={x} onPress={() => setTab(x)} style={[styles.tab, tab === x && styles.tabActive]}>
              <Text style={[styles.tabText, tab === x && { color: colors.foreground }]}>{x}</Text>
            </Pressable>
          ))}
        </View>

        {/* Scorecard */}
        {tab === "Scorecard" && (
          <View style={{ gap: 12 }}>
            {isCricket && data.innings.map((inn, i) => <InningsBlock key={i} inn={inn} />)}

            {data.statTable.length > 0 && (!isCricket || noBallByBall) &&
              data.statTable.map((t) => (
                <View key={t.teamId} style={styles.card}>
                  <Text style={styles.teamName}>{t.teamName}</Text>
                  <View style={[styles.row, styles.headRow, { marginTop: 6 }]}>
                    <Text style={[styles.hCell, { flex: 1, textAlign: "left" }]}>Player</Text>
                    {data.statFields.map((f) => (
                      <Text key={f.key} style={[styles.hCell, { width: 60 }]}>{f.label}</Text>
                    ))}
                  </View>
                  {t.rows.map((r, i) => (
                    <View key={i} style={styles.row}>
                      <Text style={[styles.playerName, { flex: 1 }]}>{r.name}</Text>
                      {data.statFields.map((f) => (
                        <Text key={f.key} style={[styles.cell, { width: 60 }]}>{r.values[f.key] ?? 0}</Text>
                      ))}
                    </View>
                  ))}
                </View>
              ))}

            {data.innings.length === 0 && data.statTable.length === 0 && (
              <View style={styles.card}>
                <Text style={styles.empty}>
                  {m.status === "SCHEDULED"
                    ? "The scorecard appears once this match starts."
                    : "No player detail was recorded for this match."}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Commentary */}
        {tab === "Commentary" && (
          <View style={styles.card}>
            {data.commentary.length === 0 ? (
              <Text style={styles.empty}>No commentary yet.</Text>
            ) : (
              data.commentary.map((c) => (
                <View key={c.seq} style={styles.commRow}>
                  {!!c.over && <Text style={styles.over}>{c.over}</Text>}
                  <Text
                    style={[
                      styles.commText,
                      c.wicket ? styles.commWicket : c.boundary ? styles.commBoundary : null,
                    ]}
                  >
                    {c.text}
                  </Text>
                </View>
              ))
            )}
          </View>
        )}

        {/* Info */}
        {tab === "Info" && (
          <View style={[styles.card, { gap: 8 }]}>
            <View style={styles.infoRow}>
              <CalendarDays size={14} color={colors.zinc500} />
              <Text style={styles.infoText}>{fmtWhen(m.scheduledAt)}</Text>
            </View>
            {!!m.venue && (
              <View style={styles.infoRow}>
                <MapPin size={14} color={colors.zinc500} />
                <Text style={styles.infoText}>{m.venue}</Text>
              </View>
            )}
            <Text style={styles.infoText}>
              {data.tournament.name} · {m.roundLabel || m.stage} · {m.sport}
            </Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
  },
  headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 8 },
  crumb: { color: colors.zinc500, fontSize: 11, flex: 1 },
  livePill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(248,113,113,0.15)", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  liveText: { color: "#f87171", fontSize: 10, fontWeight: "700" },
  statusPill: { color: colors.zinc400, fontSize: 10, backgroundColor: colors.zinc900, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, overflow: "hidden" },
  sideRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  sideName: { flex: 1, color: colors.zinc300, fontSize: 14 },
  strongWhite: { color: colors.foreground, fontWeight: "700" },
  sideScore: { color: colors.zinc300, fontSize: 17, fontWeight: "700" },
  muted: { color: colors.zinc500, fontSize: 11, fontWeight: "400" },
  result: { fontSize: 13, marginTop: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  potmRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  potm: { color: "#fbbf24", fontSize: 12 },
  tabs: { flexDirection: "row", gap: 4, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { paddingHorizontal: 14, paddingVertical: 9, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: colors.emerald500 },
  tabText: { color: colors.zinc500, fontSize: 13 },
  inningsHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8, gap: 8 },
  teamName: { color: colors.foreground, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  inningsScore: { color: colors.emerald400, fontSize: 16, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "rgba(38,38,38,0.6)" },
  headRow: { borderBottomColor: colors.border },
  hCell: { width: 36, textAlign: "right", color: colors.zinc500, fontSize: 11 },
  cell: { width: 36, textAlign: "right", color: colors.zinc400, fontSize: 13 },
  strong: { color: colors.foreground, fontWeight: "700" },
  playerName: { color: colors.foreground, fontSize: 13 },
  dismissal: { color: colors.zinc600, fontSize: 11 },
  fow: { color: colors.zinc400, fontSize: 11, marginTop: 8, lineHeight: 16 },
  empty: { color: colors.zinc500, fontSize: 13, paddingVertical: 8 },
  commRow: { flexDirection: "row", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "rgba(38,38,38,0.6)" },
  over: { width: 34, color: colors.zinc600, fontSize: 11, fontVariant: ["tabular-nums"] },
  commText: { flex: 1, color: colors.zinc300, fontSize: 13 },
  commWicket: { color: "#f87171", fontWeight: "700" },
  commBoundary: { color: colors.emerald400, fontWeight: "700" },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  infoText: { color: colors.zinc300, fontSize: 13 },
});
