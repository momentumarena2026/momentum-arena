import { View, StyleSheet } from "react-native";
import { Text } from "../../../components/ui/Text";
import { colors, radius } from "../../../theme";
import { BRACKET_STAGES, FIXTURE_STAGE_LABEL } from "./tabs";
import type {
  AdminLeaderboard,
  AdminMatchRow,
  AdminStandingsGroup,
  AdminTournamentDetail,
} from "../../../lib/admin-tournaments";

/**
 * The three tabs that only read: points table, bracket and leaders.
 *
 * None of them derive anything. The table arrives already ranked from the
 * server (same helper the web tab and the public page use) and the
 * leaderboards likewise, because an admin screen that ordered teams even
 * slightly differently from the one captains are refreshing would be
 * worse than not having the tab.
 */

function Empty({ children }: { children: string }) {
  return (
    <View style={s.empty}>
      <Text style={{ color: colors.zinc500, fontSize: 13, textAlign: "center" }}>
        {children}
      </Text>
    </View>
  );
}

// ── Overview ─────────────────────────────────────────────────────────
export function OverviewTab({ t }: { t: AdminTournamentDetail }) {
  const confirmed = t.teams.filter((x) => x.status === "CONFIRMED").length;
  const played = t.matches.filter(
    (m) => m.status === "COMPLETED" || m.status === "WALKOVER",
  ).length;
  const live = t.matches.filter((m) => m.status === "LIVE").length;
  const unscheduled = t.matches.filter((m) => !m.scheduledAt).length;
  const collected = t.teams.reduce((n, x) => n + x.paidAmount, 0);
  const due = t.teams.reduce((n, x) => n + x.dueAmount, 0);

  const tiles: { label: string; value: string; tone?: string }[] = [
    { label: "TEAMS", value: `${confirmed}/${t.totalTeams}` },
    { label: "FIXTURES", value: String(t.matches.length) },
    { label: "PLAYED", value: String(played) },
    ...(live > 0 ? [{ label: "LIVE NOW", value: String(live), tone: "#f87171" }] : []),
    ...(unscheduled > 0
      ? [{ label: "UNSCHEDULED", value: String(unscheduled), tone: "#fbbf24" }]
      : []),
    ...(t.host === "THIRD_PARTY"
      ? [{ label: "QUOTED", value: `₹${t.quotedAmount.toLocaleString("en-IN")}` }]
      : [
          { label: "COLLECTED", value: `₹${collected.toLocaleString("en-IN")}`, tone: colors.emerald400 },
          ...(due > 0
            ? [{ label: "DUE", value: `₹${due.toLocaleString("en-IN")}`, tone: "#fbbf24" }]
            : []),
        ]),
  ];

  return (
    <View style={{ gap: 10 }}>
      <View style={s.tileWrap}>
        {tiles.map((tile) => (
          <View key={tile.label} style={s.tile}>
            <Text style={s.tileLabel}>{tile.label}</Text>
            <Text style={[s.tileValue, tile.tone ? { color: tile.tone } : null]}>
              {tile.value}
            </Text>
          </View>
        ))}
      </View>
      <View style={s.card}>
        <Text style={s.rowLabel}>Format</Text>
        <Text style={s.rowValue}>
          {t.format.replace("_", " + ")} · {t.sport}
        </Text>
        <Text style={[s.rowLabel, { marginTop: 8 }]}>Entry fee</Text>
        <Text style={s.rowValue}>
          {t.entryFee > 0 ? `₹${t.entryFee.toLocaleString("en-IN")} per team` : "Free"}
        </Text>
        {t.sport === "CRICKET" && (
          <>
            <Text style={[s.rowLabel, { marginTop: 8 }]}>Cricket</Text>
            <Text style={s.rowValue}>
              {t.oversPerInnings || 0} overs · {t.wicketsPerInnings || 10} wickets a side
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

// ── Points table ─────────────────────────────────────────────────────
export function PointsTableTab({
  groups,
  teamName,
  isCricket,
}: {
  groups: AdminStandingsGroup[];
  teamName: (id: string) => string;
  isCricket: boolean;
}) {
  if (groups.length === 0 || groups.every((g) => g.rows.length === 0)) {
    return <Empty>The points table fills in once pools are drawn and results are recorded.</Empty>;
  }
  return (
    <View style={{ gap: 12 }}>
      {groups.map((g) => (
        <View key={g.id || "league"} style={s.card}>
          {g.name && <Text style={s.groupName}>{g.name}</Text>}
          <View style={[s.tr, { borderBottomColor: colors.borderStrong }]}>
            <Text style={[s.th, { flex: 1 }]}>TEAM</Text>
            <Text style={s.th}>P</Text>
            <Text style={s.th}>W</Text>
            <Text style={s.th}>L</Text>
            <Text style={[s.th, { width: 30 }]}>PTS</Text>
            {isCricket && <Text style={[s.th, { width: 48 }]}>NRR</Text>}
          </View>
          {g.rows.map((r, i) => (
            <View key={r.teamId} style={s.tr}>
              <Text style={[s.td, { flex: 1, color: colors.foreground }]} numberOfLines={1}>
                {i + 1}. {teamName(r.teamId)}
              </Text>
              <Text style={s.td}>{r.played}</Text>
              <Text style={s.td}>{r.won}</Text>
              <Text style={s.td}>{r.lost}</Text>
              <Text style={[s.td, { width: 30, color: colors.emerald400, fontWeight: "700" }]}>
                {r.points}
              </Text>
              {isCricket && (
                <Text style={[s.td, { width: 48 }]}>
                  {/* A team whose matches were all typed in by hand has no
                      ball data, so it has no run rate. Saying so beats
                      printing 0.000, which reads as "exactly par". */}
                  {r.nrr == null ? "—" : (r.nrr > 0 ? "+" : "") + r.nrr.toFixed(3)}
                </Text>
              )}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

// ── Bracket ──────────────────────────────────────────────────────────
export function BracketTab({
  matches,
  teamName,
}: {
  matches: AdminMatchRow[];
  teamName: (id: string) => string;
}) {
  const rounds = BRACKET_STAGES.map((stage) => ({
    stage,
    matches: matches.filter((m) => m.stage === stage),
  })).filter((r) => r.matches.length > 0);

  if (rounds.length === 0) {
    return <Empty>No knockout fixtures yet. They appear once the bracket is generated.</Empty>;
  }

  const side = (m: AdminMatchRow, home: boolean) => {
    const team = home ? m.homeTeam : m.awayTeam;
    const label = home ? m.homeSourceLabel : m.awaySourceLabel;
    const score = home ? m.homeScore : m.awayScore;
    const won = !!team && m.winnerTeamId === team.id;
    return (
      <View style={s.bracketSide}>
        <Text
          style={{
            color: won ? colors.emerald400 : team ? colors.zinc300 : colors.zinc600,
            fontWeight: won ? "700" : "400",
            fontSize: 13,
            flex: 1,
          }}
          numberOfLines={1}
        >
          {team ? teamName(team.id) : label || "TBD"}
        </Text>
        {score != null && (
          <Text style={{ color: won ? colors.emerald400 : colors.zinc400, fontSize: 13, fontWeight: "700" }}>
            {score}
          </Text>
        )}
      </View>
    );
  };

  return (
    <View style={{ gap: 12 }}>
      {rounds.map((r) => (
        <View key={r.stage}>
          <Text style={s.groupName}>{FIXTURE_STAGE_LABEL[r.stage] ?? r.stage}</Text>
          {r.matches.map((m) => (
            <View key={m.id} style={[s.card, { marginTop: 6 }]}>
              <Text style={{ color: colors.zinc500, fontSize: 11 }}>
                {m.roundLabel || r.stage}
                {m.status === "LIVE" ? "  🔴 live" : ""}
              </Text>
              <View style={{ marginTop: 6, gap: 4 }}>
                {side(m, true)}
                {side(m, false)}
              </View>
              {m.isDraw && (
                <Text style={{ color: colors.zinc500, fontSize: 11, marginTop: 4 }}>Drawn</Text>
              )}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

// ── Leaders ──────────────────────────────────────────────────────────
export function LeadersTab({ boards }: { boards: AdminLeaderboard[] }) {
  const withRows = boards.filter((b) => b.rows.length > 0);
  if (withRows.length === 0) {
    return <Empty>Leaderboards fill in as player stats are recorded against results.</Empty>;
  }
  return (
    <View style={{ gap: 12 }}>
      {withRows.map((b) => (
        <View key={b.key} style={s.card}>
          <Text style={s.groupName}>{b.label}</Text>
          {b.rows.slice(0, 10).map((r, i) => (
            <View key={`${b.key}-${r.name}-${i}`} style={s.tr}>
              <Text style={[s.td, { width: 22 }]}>{i + 1}</Text>
              <Text style={[s.td, { flex: 1, color: colors.foreground }]} numberOfLines={1}>
                {r.name}
                {r.teamName ? <Text style={{ color: colors.zinc500 }}> · {r.teamName}</Text> : null}
              </Text>
              <Text style={[s.td, { color: colors.emerald400, fontWeight: "700" }]}>{r.value}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  empty: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
  },
  groupName: { color: colors.foreground, fontWeight: "700", fontSize: 13, marginBottom: 6 },
  tileWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: {
    flexGrow: 1,
    minWidth: 96,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  tileLabel: { color: colors.zinc500, fontSize: 10, letterSpacing: 0.6 },
  tileValue: { color: colors.foreground, fontSize: 19, fontWeight: "700", marginTop: 2 },
  rowLabel: { color: colors.zinc500, fontSize: 10, letterSpacing: 0.6 },
  rowValue: { color: colors.zinc300, fontSize: 13, marginTop: 1 },
  tr: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(38,38,38,0.6)",
  },
  th: { color: colors.zinc500, fontSize: 10, width: 22, textAlign: "center" },
  td: { color: colors.zinc400, fontSize: 12, width: 22, textAlign: "center" },
  bracketSide: { flexDirection: "row", alignItems: "center", gap: 8 },
});
