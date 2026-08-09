import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../ui/Text";
import { colors, radius } from "../../theme";
import type { MatchLite, TeamLite } from "../../lib/tournaments";

/**
 * Knockout bracket for the app — the web BracketView, in React Native.
 *
 * Same recursive layout, and for the same reason: a match renders its two
 * feeders to its left and centres itself against them, so the connecting
 * elbows land in the right place without measuring anything with
 * onLayout. Measuring would mean a second render pass and a visible jump
 * on a slower phone.
 *
 * The tree follows homeSourceMatchId / awaySourceMatchId, so it matches
 * however the rounds were actually wired; a match with no sources is a
 * leaf, which is what makes a pools-fed knockout draw correctly.
 */

const KO_STAGES = ["R64", "R32", "R16", "QF", "SF", "FINAL"];

const STAGE_TITLE: Record<string, string> = {
  R64: "Round of 64",
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter Finals",
  SF: "Semi Finals",
  FINAL: "Final",
};

const BOX_W = 190;
const ELBOW_W = 20;

type Node = { match: MatchLite; feeders: Node[] };

function depthOf(n: Node): number {
  return n.feeders.length === 0 ? 1 : 1 + Math.max(...n.feeders.map(depthOf));
}

export function BracketTree({
  matches,
  teams,
  onMatchPress,
  renderBadge,
}: {
  matches: MatchLite[];
  teams: Map<string, TeamLite>;
  onMatchPress?: (m: MatchLite) => void;
  renderBadge?: (team: TeamLite | null) => React.ReactNode;
}) {
  const ko = matches.filter((m) => KO_STAGES.includes(m.stage));
  const third = matches.filter((m) => m.stage === "THIRD_PLACE");

  if (ko.length === 0) {
    return (
      <View style={styles.empty}>
        <Text variant="small" color={colors.zinc500}>
          The bracket appears once knockout fixtures are generated.
        </Text>
      </View>
    );
  }

  const byId = new Map(ko.map((m) => [m.id, m]));
  const referenced = new Set<string>();
  for (const m of ko) {
    if (m.homeSourceMatchId) referenced.add(m.homeSourceMatchId);
    if (m.awaySourceMatchId) referenced.add(m.awaySourceMatchId);
  }

  const build = (m: MatchLite, seen: Set<string>): Node => {
    seen.add(m.id);
    const feeders = [m.homeSourceMatchId, m.awaySourceMatchId]
      .map((id) => (id && !seen.has(id) ? byId.get(id) : undefined))
      .filter((x): x is MatchLite => !!x)
      .map((x) => build(x, seen));
    return { match: m, feeders };
  };

  const roots = ko
    .filter((m) => !referenced.has(m.id))
    .sort((a, b) => KO_STAGES.indexOf(b.stage) - KO_STAGES.indexOf(a.stage))
    .map((m) => build(m, new Set()));

  const columns = Math.max(...roots.map(depthOf));
  const rootStage = roots[0]?.match.stage ?? "FINAL";
  const endIdx = KO_STAGES.indexOf(rootStage);
  const headings = KO_STAGES.slice(Math.max(0, endIdx - columns + 1), endIdx + 1);

  const champion =
    roots.length === 1 && roots[0].match.stage === "FINAL"
      ? roots[0].match.winnerTeamId
      : null;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ paddingRight: 16 }}>
        <View style={{ flexDirection: "row" }}>
          {headings.map((st) => (
            <Text key={st} style={styles.heading}>
              {STAGE_TITLE[st] ?? st}
            </Text>
          ))}
          {champion ? (
            <Text style={[styles.heading, { color: colors.emerald500 }]}>Champion</Text>
          ) : null}
        </View>

        {roots.map((root) => (
          <View
            key={root.match.id}
            style={{ flexDirection: "row", alignItems: "center", marginBottom: 16 }}
          >
            <BracketNode
              node={root}
              teams={teams}
              onMatchPress={onMatchPress}
              renderBadge={renderBadge}
            />
            {champion ? (
              <>
                <View style={styles.elbow} />
                <View style={{ width: BOX_W }}>
                  <View style={styles.championBox}>
                    <View style={styles.row}>
                      {renderBadge?.(teams.get(champion) ?? null)}
                      <Text
                        numberOfLines={1}
                        weight="800"
                        style={styles.championName}
                      >
                        {teams.get(champion)?.name ?? "—"}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.trophy}>🏆</Text>
                </View>
              </>
            ) : null}
          </View>
        ))}

        {third.length > 0 && (
          <View style={{ marginTop: 8 }}>
            <Text style={[styles.heading, { width: BOX_W, textAlign: "left" }]}>
              Third place
            </Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              {third.map((m) => (
                <View key={m.id} style={{ width: BOX_W }}>
                  <MatchBox
                    match={m}
                    teams={teams}
                    onMatchPress={onMatchPress}
                    renderBadge={renderBadge}
                  />
                </View>
              ))}
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function BracketNode({
  node,
  teams,
  onMatchPress,
  renderBadge,
}: {
  node: Node;
  teams: Map<string, TeamLite>;
  onMatchPress?: (m: MatchLite) => void;
  renderBadge?: (team: TeamLite | null) => React.ReactNode;
}) {
  const { match, feeders } = node;
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {feeders.length > 0 && (
        <View>
          {feeders.map((f, i) => (
            <View key={f.match.id} style={styles.feederRow}>
              <BracketNode
                node={f}
                teams={teams}
                onMatchPress={onMatchPress}
                renderBadge={renderBadge}
              />
              <View style={styles.elbow} />
              {/* Half of the vertical spine each: the upper feeder draws
                  from its own centre down, the lower one up to its centre,
                  meeting on the parent's centre line. One feeder alone
                  draws none, so nothing dangles. */}
              {feeders.length > 1 && (
                <View
                  style={[
                    styles.spine,
                    i === 0 ? { top: "50%", bottom: 0 } : { top: 0, bottom: "50%" },
                  ]}
                />
              )}
            </View>
          ))}
        </View>
      )}
      {feeders.length > 0 && <View style={styles.elbow} />}
      <View style={{ width: BOX_W }}>
        <MatchBox
          match={match}
          teams={teams}
          onMatchPress={onMatchPress}
          renderBadge={renderBadge}
        />
      </View>
    </View>
  );
}

function MatchBox({
  match: m,
  teams,
  onMatchPress,
  renderBadge,
}: {
  match: MatchLite;
  teams: Map<string, TeamLite>;
  onMatchPress?: (m: MatchLite) => void;
  renderBadge?: (team: TeamLite | null) => React.ReactNode;
}) {
  const live = m.status === "LIVE";
  const sides = [
    {
      id: m.homeTeamId,
      label: m.homeTeamId ? teams.get(m.homeTeamId)?.name : m.homeSourceLabel,
      score: m.homeScore,
      note: m.homeScoreNote,
    },
    {
      id: m.awayTeamId,
      label: m.awayTeamId ? teams.get(m.awayTeamId)?.name : m.awaySourceLabel,
      score: m.awayScore,
      note: m.awayScoreNote,
    },
  ];

  const inner = (
    <View style={[styles.box, live && { borderColor: "rgba(239,68,68,0.5)" }]}>
      <View style={styles.boxHead}>
        <Text numberOfLines={1} style={styles.boxHeadText}>
          {m.roundLabel || STAGE_TITLE[m.stage] || m.stage}
        </Text>
        {live && (
          <Text weight="700" style={styles.liveText}>
            ● LIVE
          </Text>
        )}
      </View>
      {sides.map((s, i) => {
        const won = !!m.winnerTeamId && s.id === m.winnerTeamId;
        return (
          <View key={i} style={[styles.side, i === 0 && styles.sideDivider]}>
            {/* Green bar = this side went through. */}
            <View
              style={[
                styles.accent,
                { backgroundColor: won ? colors.emerald500 : colors.zinc700 },
              ]}
            />
            {renderBadge?.(s.id ? (teams.get(s.id) ?? null) : null)}
            <Text
              numberOfLines={1}
              style={[
                styles.sideName,
                won
                  ? { color: "#6ee7b7", fontWeight: "700" }
                  : s.id
                    ? { color: colors.zinc300 }
                    : { color: colors.zinc600, fontStyle: "italic" },
              ]}
            >
              {s.label || "TBD"}
            </Text>
            {s.note ? (
              <Text style={styles.sideScore}>{s.note}</Text>
            ) : s.score != null ? (
              <Text
                weight="700"
                style={[
                  styles.sideScore,
                  won && { color: colors.emerald400 },
                ]}
              >
                {s.score}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );

  // Only a match with both sides decided has a match centre worth opening.
  return onMatchPress && m.homeTeamId && m.awayTeamId ? (
    <Pressable onPress={() => onMatchPress(m)}>{inner}</Pressable>
  ) : (
    inner
  );
}

const styles = StyleSheet.create({
  empty: {
    borderWidth: 1,
    borderColor: colors.zinc800,
    borderRadius: radius.lg,
    backgroundColor: colors.zinc900,
    padding: 24,
    alignItems: "center",
  },
  heading: {
    width: BOX_W + ELBOW_W * 2,
    textAlign: "center",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: colors.zinc500,
    marginBottom: 8,
  },
  feederRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  elbow: { height: 1, width: ELBOW_W, backgroundColor: colors.zinc700 },
  spine: { position: "absolute", right: 0, width: 1, backgroundColor: colors.zinc700 },
  box: {
    borderWidth: 1,
    borderColor: colors.zinc800,
    borderRadius: radius.md,
    backgroundColor: colors.zinc900,
    overflow: "hidden",
  },
  boxHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.zinc800,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  boxHeadText: {
    flex: 1,
    fontSize: 9,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.zinc500,
  },
  liveText: { fontSize: 9, color: "#f87171" },
  side: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 6 },
  sideDivider: { borderBottomWidth: 1, borderBottomColor: colors.zinc800 },
  accent: { width: 3, height: 18, borderRadius: 2 },
  sideName: { flex: 1, fontSize: 12 },
  sideScore: { fontSize: 12, color: colors.zinc400 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  championBox: {
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.4)",
    borderRadius: radius.md,
    backgroundColor: "rgba(16,185,129,0.1)",
    padding: 10,
  },
  championName: { flex: 1, fontSize: 13, color: "#6ee7b7" },
  trophy: { fontSize: 26, textAlign: "center", marginTop: 6 },
});
