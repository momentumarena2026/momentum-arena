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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ChevronLeft, Radio, Trophy } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius } from "../../theme";
import {
  adminTournamentsApi,
  type AdminMatchRow,
  type AdminTournamentDetail,
} from "../../lib/admin-tournaments";
import type { RootStackParamList } from "../../navigation/types";

// Lifecycle transitions mirrored from lib/tournament-config STATUS_FLOW.
const FLOW: Record<string, string[]> = {
  DRAFT: ["PUBLISHED", "CANCELLED"],
  PUBLISHED: ["REG_OPEN", "CANCELLED"],
  REG_OPEN: ["REG_CLOSED", "CANCELLED"],
  REG_CLOSED: ["POOLS_REVEALED", "LIVE", "CANCELLED"],
  POOLS_REVEALED: ["LIVE", "CANCELLED"],
  LIVE: ["COMPLETED", "CANCELLED"],
};
const LABEL: Record<string, string> = {
  PUBLISHED: "Publish",
  REG_OPEN: "Open Registrations",
  REG_CLOSED: "Close Registrations",
  POOLS_REVEALED: "Reveal Pools",
  LIVE: "Go Live",
  COMPLETED: "Complete",
  CANCELLED: "Cancel",
};

const input: object = {
  borderRadius: radius.lg,
  borderWidth: 1,
  borderColor: colors.borderStrong,
  backgroundColor: colors.zinc900,
  color: colors.foreground,
  paddingHorizontal: 12,
  paddingVertical: 9,
  fontSize: 13,
};

export function AdminTournamentsScreen() {
  const queryClient = useQueryClient();
  // The scorer screens live on the ROOT stack (they're auth-free).
  // navigate() bubbles up through parent navigators until it finds the
  // route, so no manual getParent() walk is needed from inside the shell.
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scoreFor, setScoreFor] = useState<string | null>(null);
  const [scores, setScores] = useState({ home: "", away: "" });
  const [venueOpen, setVenueOpen] = useState(false);
  const [venue, setVenue] = useState({ teamName: "", captainName: "", captainPhone: "", members: "", collectedAmount: "", method: "CASH" });
  // Per-team squad editor — squads are optional at registration, so
  // admins can build/fix any roster from here.
  const [squadFor, setSquadFor] = useState<string | null>(null);
  const [squadText, setSquadText] = useState("");

  const { data: list, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["admin-tournaments"],
    queryFn: adminTournamentsApi.list,
  });
  const { data: detailData, refetch: refetchDetail } = useQuery({
    queryKey: ["admin-tournament", openId],
    queryFn: () => adminTournamentsApi.detail(openId!),
    enabled: !!openId,
    refetchInterval: 12000,
  });
  const t: AdminTournamentDetail | undefined = detailData?.tournament;

  const act = async (body: Record<string, unknown>, confirmMsg?: string) => {
    const run = async () => {
      setBusy(true);
      try {
        await adminTournamentsApi.action(body);
        await Promise.all([refetchDetail(), refetch()]);
        queryClient.invalidateQueries({ queryKey: ["tournaments"] });
      } catch (e) {
        Alert.alert("Failed", e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setBusy(false);
      }
    };
    if (confirmMsg) {
      Alert.alert("Confirm", confirmMsg, [
        { text: "Cancel", style: "cancel" },
        { text: "Yes", onPress: run },
      ]);
    } else await run();
  };

  const submitScore = async (m: AdminMatchRow) => {
    const home = parseInt(scores.home, 10);
    const away = parseInt(scores.away, 10);
    if (isNaN(home) || isNaN(away)) return;
    const isRR = m.stage === "POOL" || m.stage === "LEAGUE";
    const finish = (winnerTeamId?: string, isDraw?: boolean) =>
      act({
        op: "enterResult",
        matchId: m.id,
        result: { homeScore: home, awayScore: away, isDraw: !!isDraw, winnerTeamId, playerStats: [] },
      }).then(() => {
        setScoreFor(null);
        setScores({ home: "", away: "" });
      });
    if (home === away) {
      const buttons = [
        ...(isRR ? [{ text: "Draw", onPress: () => finish(undefined, true) }] : []),
        { text: m.homeTeam?.name || "Home", onPress: () => finish(m.homeTeam?.id) },
        { text: m.awayTeam?.name || "Away", onPress: () => finish(m.awayTeam?.id) },
        { text: "Cancel", style: "cancel" as const },
      ];
      Alert.alert("Scores level", "Who takes it?", buttons);
      return;
    }
    await finish();
  };

  // ── Detail ──
  if (openId && t) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable onPress={() => setOpenId(null)} style={styles.back}>
            <ChevronLeft size={16} color={colors.zinc400} />
            <Text style={{ color: colors.zinc400, fontSize: 13 }}>All tournaments</Text>
          </Pressable>

          <Text style={styles.h1}>{t.name}</Text>
          <Text style={styles.sub}>
            {t.sport} · {t.status} · {t.teams.filter((x) => x.status === "CONFIRMED").length}/{t.totalTeams} teams
          </Text>
          {t.liveScoringEnabled && t.scorerCode && (
            <View style={[styles.rowWrap, { marginTop: 4, alignItems: "center" }]}>
              <Text style={{ color: "#f87171", fontSize: 12 }}>
                Scorer code: <Text style={{ fontWeight: "700" }}>{t.scorerCode}</Text>
              </Text>
              {/* One tap into the native pad — no retyping a URL on a
                  field phone, and no admin login needed to score. */}
              <Pressable
                onPress={() => rootNavigation.navigate("ScorerConsole", { code: t.scorerCode! })}
                style={[styles.chipBtn, { borderColor: "rgba(248,113,113,0.4)" }]}
              >
                <Text style={{ color: "#f87171", fontSize: 12 }}>Open scorer</Text>
              </Pressable>
            </View>
          )}

          {/* Lifecycle */}
          <View style={styles.rowWrap}>
            {(FLOW[t.status] || []).map((to) => (
              <Pressable
                key={to}
                disabled={busy}
                onPress={() =>
                  act({ op: "transition", tournamentId: t.id, to }, `Move to ${LABEL[to] || to}?`)
                }
                style={[styles.chipBtn, to === "CANCELLED" && { borderColor: "rgba(248,113,113,0.4)" }]}
              >
                <Text style={{ color: to === "CANCELLED" ? "#f87171" : colors.emerald400, fontSize: 12 }}>
                  {LABEL[to] || to}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Structure ops */}
          <View style={styles.rowWrap}>
            {t.format === "POOLS_KNOCKOUT" && ["REG_OPEN", "REG_CLOSED"].includes(t.status) && (
              <Pressable disabled={busy} onPress={() => act({ op: "dealPools", tournamentId: t.id }, "Randomly (re-)deal the pools?")} style={styles.chipBtn}>
                <Text style={{ color: "#a78bfa", fontSize: 12 }}>🎲 Deal pools</Text>
              </Pressable>
            )}
            <Pressable disabled={busy} onPress={() => act({ op: "generateFixtures", tournamentId: t.id }, "Generate/regenerate fixtures?")} style={styles.chipBtn}>
              <Text style={{ color: "#7dd3fc", fontSize: 12 }}>📅 Generate fixtures</Text>
            </Pressable>
          </View>

          {/* Teams */}
          <Text style={styles.section}>Teams</Text>
          <Pressable onPress={() => setVenueOpen((x) => !x)} style={styles.chipBtn}>
            <Text style={{ color: colors.emerald400, fontSize: 12 }}>+ Register team (venue)</Text>
          </Pressable>
          {venueOpen && (
            <View style={styles.card}>
              <TextInput style={input as never} placeholder="Team name" placeholderTextColor={colors.zinc600} value={venue.teamName} onChangeText={(v) => setVenue((f) => ({ ...f, teamName: v }))} />
              <TextInput style={[input as never, { marginTop: 8 }]} placeholder="Captain name" placeholderTextColor={colors.zinc600} value={venue.captainName} onChangeText={(v) => setVenue((f) => ({ ...f, captainName: v }))} />
              <TextInput style={[input as never, { marginTop: 8 }]} placeholder="Captain phone" keyboardType="phone-pad" placeholderTextColor={colors.zinc600} value={venue.captainPhone} onChangeText={(v) => setVenue((f) => ({ ...f, captainPhone: v }))} />
              <TextInput style={[input as never, { marginTop: 8 }]} placeholder="Players (comma-separated, optional)" placeholderTextColor={colors.zinc600} value={venue.members} onChangeText={(v) => setVenue((f) => ({ ...f, members: v }))} />
              <TextInput style={[input as never, { marginTop: 8 }]} placeholder={`Collected now (fee ₹${t.entryFee})`} keyboardType="numeric" placeholderTextColor={colors.zinc600} value={venue.collectedAmount} onChangeText={(v) => setVenue((f) => ({ ...f, collectedAmount: v }))} />
              <View style={[styles.rowWrap, { marginTop: 8 }]}>
                {(["CASH", "STATIC_QR", "FREE"] as const).map((m) => (
                  <Pressable key={m} onPress={() => setVenue((f) => ({ ...f, method: m }))} style={[styles.chipBtn, venue.method === m && { backgroundColor: colors.emerald500_10 }]}>
                    <Text style={{ color: venue.method === m ? colors.emerald400 : colors.zinc400, fontSize: 12 }}>
                      {m === "STATIC_QR" ? "Static QR" : m === "CASH" ? "Cash" : "Free"}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                disabled={busy || !venue.teamName.trim() || !venue.captainName.trim()}
                onPress={() =>
                  act({
                    op: "venueRegister",
                    tournamentId: t.id,
                    teamName: venue.teamName,
                    captainName: venue.captainName,
                    captainPhone: venue.captainPhone,
                    members: venue.members.split(",").map((x) => x.trim()).filter(Boolean),
                    collectedAmount: parseInt(venue.collectedAmount, 10) || 0,
                    method: venue.method,
                  }).then(() => {
                    setVenueOpen(false);
                    setVenue({ teamName: "", captainName: "", captainPhone: "", members: "", collectedAmount: "", method: "CASH" });
                  })
                }
                style={[styles.primaryBtn, { marginTop: 10 }]}
              >
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Confirm registration</Text>
              </Pressable>
            </View>
          )}
          {t.teams.map((team) => (
            <View key={team.id} style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 14 }}>{team.name}</Text>
                <Text style={{ color: team.status === "CONFIRMED" ? colors.emerald400 : "#fbbf24", fontSize: 11 }}>
                  {team.status.replace("_", " ")}
                  {team.pool ? ` · ${team.pool.name}` : ""}
                </Text>
              </View>
              <Text style={{ color: colors.zinc500, fontSize: 12 }}>
                {team.captainName} · {team.captainPhone} · Paid ₹{team.paidAmount}
                {team.dueAmount > 0 ? ` · Due ₹${team.dueAmount}` : ""}
              </Text>
              {squadFor === team.id ? (
                <View style={{ marginTop: 8, gap: 8 }}>
                  <TextInput
                    style={input as never}
                    placeholder="Players (comma-separated)"
                    placeholderTextColor={colors.zinc600}
                    value={squadText}
                    onChangeText={setSquadText}
                    multiline
                  />
                  <Text style={{ color: colors.zinc600, fontSize: 11 }}>
                    Keep a player&apos;s name to preserve their stats; players with stats can&apos;t be removed.
                  </Text>
                  <View style={styles.rowWrap}>
                    <Pressable
                      disabled={busy}
                      onPress={() =>
                        act({
                          op: "editSquad",
                          teamId: team.id,
                          members: squadText.split(",").map((x) => x.trim()).filter(Boolean),
                        }).then(() => setSquadFor(null))
                      }
                      style={styles.chipBtn}
                    >
                      <Text style={{ color: colors.emerald400, fontSize: 12 }}>Save squad</Text>
                    </Pressable>
                    <Pressable onPress={() => setSquadFor(null)} style={styles.chipBtn}>
                      <Text style={{ color: colors.zinc400, fontSize: 12 }}>Cancel</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Text style={{ color: colors.zinc400, fontSize: 12, marginTop: 4 }} numberOfLines={2}>
                  Squad: {team.members.length > 0 ? team.members.map((m) => m.name).join(", ") : "—"}
                </Text>
              )}
              <View style={[styles.rowWrap, { marginTop: 8 }]}>
                {squadFor !== team.id && (
                  <Pressable
                    disabled={busy}
                    onPress={() => {
                      setSquadFor(team.id);
                      setSquadText(team.members.map((m) => m.name).join(", "));
                    }}
                    style={styles.chipBtn}
                  >
                    <Text style={{ color: "#a78bfa", fontSize: 12 }}>
                      {team.members.length <= 1 ? "+ Squad" : "✎ Squad"}
                    </Text>
                  </Pressable>
                )}
                {team.status !== "CONFIRMED" && (
                  <Pressable disabled={busy} onPress={() => act({ op: "teamStatus", teamId: team.id, status: "CONFIRMED" })} style={styles.chipBtn}>
                    <Text style={{ color: colors.emerald400, fontSize: 12 }}>Confirm</Text>
                  </Pressable>
                )}
                {team.dueAmount > 0 && (
                  <Pressable
                    disabled={busy}
                    onPress={() =>
                      act({ op: "collect", teamId: team.id, amount: team.dueAmount, method: "CASH" }, `Collect ₹${team.dueAmount} cash?`)
                    }
                    style={styles.chipBtn}
                  >
                    <Text style={{ color: "#fbbf24", fontSize: 12 }}>Collect ₹{team.dueAmount}</Text>
                  </Pressable>
                )}
                {!["REJECTED", "WITHDRAWN"].includes(team.status) && (
                  <Pressable disabled={busy} onPress={() => act({ op: "teamStatus", teamId: team.id, status: "REJECTED" }, "Reject this team? Redeemed points are refunded.")} style={styles.chipBtn}>
                    <Text style={{ color: "#f87171", fontSize: 12 }}>Reject</Text>
                  </Pressable>
                )}
              </View>
            </View>
          ))}

          {/* Scores */}
          <Text style={styles.section}>Scores</Text>
          {t.matches
            .filter((m) => m.homeTeam && m.awayTeam && (m.status === "SCHEDULED" || m.status === "LIVE"))
            .map((m) => (
              <View key={m.id} style={styles.card}>
                <Text style={{ color: colors.zinc500, fontSize: 11 }}>{m.roundLabel}</Text>
                <Text style={{ color: colors.foreground, fontSize: 13, marginTop: 2 }}>
                  {m.homeTeam?.name} vs {m.awayTeam?.name}
                  {m.status === "LIVE" ? "  🔴" : ""}
                </Text>
                {scoreFor === m.id ? (
                  <View style={[styles.rowWrap, { marginTop: 8, alignItems: "center" }]}>
                    <TextInput style={[input as never, { width: 70 }]} placeholder="Home" keyboardType="numeric" placeholderTextColor={colors.zinc600} value={scores.home} onChangeText={(v) => setScores((s) => ({ ...s, home: v }))} />
                    <TextInput style={[input as never, { width: 70 }]} placeholder="Away" keyboardType="numeric" placeholderTextColor={colors.zinc600} value={scores.away} onChangeText={(v) => setScores((s) => ({ ...s, away: v }))} />
                    <Pressable disabled={busy} onPress={() => submitScore(m)} style={styles.chipBtn}>
                      <Text style={{ color: colors.emerald400, fontSize: 12 }}>Save</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable onPress={() => { setScoreFor(m.id); setScores({ home: "", away: "" }); }} style={[styles.chipBtn, { marginTop: 8, alignSelf: "flex-start" }]}>
                    <Text style={{ color: "#7dd3fc", fontSize: 12 }}>Enter result</Text>
                  </Pressable>
                )}
              </View>
            ))}
          {t.matches.filter((m) => m.status === "COMPLETED").length > 0 && (
            <Text style={{ color: colors.zinc500, fontSize: 12 }}>
              {t.matches.filter((m) => m.status === "COMPLETED").length} completed — full stats entry on the web admin.
            </Text>
          )}
        </ScrollView>
      </Screen>
    );
  }

  // ── List ──
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.emerald400} />}
      >
        {isLoading && <Skeleton height={90} />}
        {!isLoading && (list?.tournaments.length ?? 0) === 0 && (
          <View style={{ alignItems: "center", paddingVertical: 50, gap: 10 }}>
            <Trophy size={36} color={colors.zinc600} />
            <Text style={{ color: colors.zinc500, fontSize: 13 }}>
              No tournaments yet — create one from the web admin.
            </Text>
          </View>
        )}
        {list?.tournaments.map((x) => (
          <Pressable key={x.id} onPress={() => setOpenId(x.id)} style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 15 }}>{x.name}</Text>
              {x.status === "LIVE" && <Radio size={13} color="#f87171" />}
            </View>
            <Text style={{ color: colors.zinc500, fontSize: 12, marginTop: 2 }}>
              {x.sport} · {x.status} · {x.teams}/{x.totalTeams} teams · {x.matches} matches
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10, paddingBottom: 60 },
  back: { flexDirection: "row", alignItems: "center", gap: 2 },
  h1: { color: colors.foreground, fontSize: 19, fontWeight: "800" },
  sub: { color: colors.zinc400, fontSize: 13 },
  section: {
    color: colors.zinc400,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    marginTop: 10,
  },
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
  },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chipBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  primaryBtn: {
    backgroundColor: colors.emerald500,
    borderRadius: radius.lg,
    paddingVertical: 12,
    alignItems: "center",
  },
});
