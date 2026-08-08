import { useCallback, useEffect, useState } from "react";
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
import { ChevronLeft, Radio, Trophy } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius } from "../../theme";
import {
  adminTournamentsApi,
  type AdminMatchRow,
  type AdminSlotWindow,
  type AdminTournamentDetail,
  type OrganizerLedger,
} from "../../lib/admin-tournaments";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { AdminMoreStackParamList } from "../../navigation/types";
import { usePullToRefresh } from "../../hooks/usePullToRefresh";

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

const hourLabel = (h: number) => {
  const hr = h % 24;
  const am = hr < 12;
  const v = hr % 12 === 0 ? 12 : hr % 12;
  return `${v}${am ? "am" : "pm"}`;
};

/**
 * Turn a team's stored `<slotId>#<hour>` picks into something readable on
 * a phone: "Sat 9 6-9am · Sun 10 4-6pm". Empty picks mean "any window
 * works" to the draw generator, so say that rather than showing nothing.
 */
function preferredSummary(
  picks: string[] | undefined,
  windows: AdminSlotWindow[],
): string {
  if (!picks || picks.length === 0) return "any window";
  const byWindow = new Map<string, number[]>();
  for (const key of picks) {
    const [slotId, raw] = key.split("#");
    const hour = Number(raw);
    if (!slotId || !Number.isInteger(hour)) continue;
    const list = byWindow.get(slotId);
    if (list) list.push(hour);
    else byWindow.set(slotId, [hour]);
  }
  const parts: string[] = [];
  for (const w of windows) {
    const hours = byWindow.get(w.id);
    if (!hours?.length) continue;
    const sorted = [...hours].sort((a, b) => a - b);
    const spans: [number, number][] = [];
    for (const h of sorted) {
      const last = spans[spans.length - 1];
      if (last && h === last[1]) last[1] = h + 1;
      else spans.push([h, h + 1]);
    }
    const day = new Date(w.date).toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      timeZone: "Asia/Kolkata",
    });
    parts.push(
      `${day} ${spans.map(([a, b]) => `${hourLabel(a)}\u2013${hourLabel(b)}`).join(", ")}`,
    );
  }
  // Picks whose window was deleted resolve to nothing — don't imply the
  // captain left it blank when they didn't.
  return parts.length > 0 ? parts.join(" · ") : "—";
}

export function AdminTournamentsScreen() {
  const queryClient = useQueryClient();
  // Push onto THIS stack — the console is registered here as well as at
  // the root, so opening it never has to cross a navigator boundary.
  const navigation = useNavigation<NativeStackNavigationProp<AdminMoreStackParamList>>();
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scoreFor, setScoreFor] = useState<string | null>(null);
  const [scores, setScores] = useState({ home: "", away: "" });
  const [venueOpen, setVenueOpen] = useState(false);
  // Organiser billing (THIRD_PARTY only). The ledger is fetched on demand
  // rather than folded into the detail payload, so our own tournaments —
  // the overwhelming majority — pay nothing for a panel they never show.
  const [orgOpen, setOrgOpen] = useState(false);
  const [fxOpen, setFxOpen] = useState(false);
  const [schedFor, setSchedFor] = useState<string | null>(null);
  const [sched, setSched] = useState({ date: "", startHour: "", hours: "1", courtConfigId: "" });
  const [fx, setFx] = useState({
    stage: "LEAGUE",
    roundLabel: "",
    homeTeamId: "",
    awayTeamId: "",
    homeSourceLabel: "",
    awaySourceLabel: "",
  });
  const [ledger, setLedger] = useState<OrganizerLedger | null>(null);
  const [org, setOrg] = useState({
    amount: "",
    method: "CASH",
    receivedAt: new Date().toISOString().slice(0, 10),
    reference: "",
  });
  const [venue, setVenue] = useState({ teamName: "", captainName: "", captainPhone: "", members: "", collectedAmount: "", method: "CASH" });
  // Per-team squad editor — squads are optional at registration, so
  // admins can build/fix any roster from here.
  const [squadFor, setSquadFor] = useState<string | null>(null);
  const [squadText, setSquadText] = useState("");

  const { data: list, isLoading, refetch } = useQuery({
    queryKey: ["admin-tournaments"],
    queryFn: adminTournamentsApi.list,
  });
  const { data: detailData, refetch: refetchDetail } = useQuery({
    queryKey: ["admin-tournament", openId],
    queryFn: () => adminTournamentsApi.detail(openId!),
    enabled: !!openId,
    refetchInterval: 12000,
  });
  // The open tournament polls every 12s for live scores; keep that
  // invisible and let the spinner mean "I pulled".
  const { refreshing: pullRefreshing, onRefresh: onPullRefresh } =
    usePullToRefresh(refetch);
  const t: AdminTournamentDetail | undefined = detailData?.tournament;
  const courts = detailData?.courts ?? [];
  const windows = detailData?.windows ?? [];

  const hr = (h: number) =>
    h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`;
  const windowLabel = (w: (typeof windows)[number]) =>
    `${new Date(w.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" })} · ${hr(w.startHour)}–${hr(w.endHour)}${w.courtLabel ? ` · ${w.courtLabel}` : ""}`;

  const loadLedger = useCallback(async () => {
    if (!t || t.host !== "THIRD_PARTY") return;
    try {
      const res = await adminTournamentsApi.organizerLedger(t.id);
      setLedger(res.ledger);
    } catch {
      // A missing ledger just leaves the tiles at zero; it must never take
      // the whole tournament screen down.
      setLedger(null);
    }
  }, [t]);

  useEffect(() => {
    void loadLedger();
  }, [loadLedger]);

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
                onPress={() =>
                  navigation.navigate("AdminScorerConsole", { code: t.scorerCode! })
                }
                style={[styles.chipBtn, { borderColor: "rgba(248,113,113,0.4)" }]}
              >
                <Text style={{ color: "#f87171", fontSize: 12 }}>Open scorer</Text>
              </Pressable>
              {/* Rotating the code was web-only, which is backwards: you
                  discover it has leaked at the venue, phone in hand. */}
              <Pressable
                disabled={busy}
                onPress={() =>
                  act(
                    { op: "rotateScorer", tournamentId: t.id },
                    "Rotate the scorer code? The old code stops working immediately.",
                  )
                }
                style={styles.chipBtn}
              >
                <Text style={{ color: colors.zinc400, fontSize: 12 }}>Rotate</Text>
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
            <Pressable disabled={busy} onPress={() => setFxOpen((x) => !x)} style={styles.chipBtn}>
              <Text style={{ color: colors.emerald400, fontSize: 12 }}>+ Add match by hand</Text>
            </Pressable>
          </View>

          {/* Hand-entered fixture. Needed whenever the organiser's schedule
              is something generateFixtures cannot derive — a second leg, an
              odd number of semi-finals. Either side may be a real team or a
              placeholder ("Winner SF1") when it is not decided yet. */}
          {fxOpen && (
            <View style={styles.card}>
              <Text style={{ color: colors.zinc500, fontSize: 11 }}>Stage</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                {(["LEAGUE", "POOL", "R16", "QF", "SF", "THIRD_PLACE", "FINAL"] as const).map((sg) => (
                  <Pressable key={sg} onPress={() => setFx((f) => ({ ...f, stage: sg }))} style={[styles.chipBtn, fx.stage === sg && { borderColor: colors.emerald400 }]}>
                    <Text style={{ color: fx.stage === sg ? colors.emerald400 : colors.zinc400, fontSize: 11 }}>{sg}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput style={[input as never, { marginTop: 8 }]} placeholder="Label, e.g. Match 4 / Semi-Final 1" placeholderTextColor={colors.zinc600} value={fx.roundLabel} onChangeText={(v) => setFx((f) => ({ ...f, roundLabel: v }))} />
              <Text style={{ color: colors.zinc500, fontSize: 11, marginTop: 10 }}>
                Home — pick a team, or leave blank and give a placeholder
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                {t.teams.filter((x) => x.status === "CONFIRMED").map((tm) => (
                  <Pressable key={tm.id} onPress={() => setFx((f) => ({ ...f, homeTeamId: f.homeTeamId === tm.id ? "" : tm.id }))} style={[styles.chipBtn, fx.homeTeamId === tm.id && { borderColor: colors.emerald400 }]}>
                    <Text style={{ color: fx.homeTeamId === tm.id ? colors.emerald400 : colors.zinc400, fontSize: 11 }}>{tm.name}</Text>
                  </Pressable>
                ))}
              </View>
              {!fx.homeTeamId && (
                <TextInput style={[input as never, { marginTop: 6 }]} placeholder="Home placeholder, e.g. Winner SF1" placeholderTextColor={colors.zinc600} value={fx.homeSourceLabel} onChangeText={(v) => setFx((f) => ({ ...f, homeSourceLabel: v }))} />
              )}
              <Text style={{ color: colors.zinc500, fontSize: 11, marginTop: 10 }}>Away</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                {t.teams.filter((x) => x.status === "CONFIRMED").map((tm) => (
                  <Pressable key={tm.id} onPress={() => setFx((f) => ({ ...f, awayTeamId: f.awayTeamId === tm.id ? "" : tm.id }))} style={[styles.chipBtn, fx.awayTeamId === tm.id && { borderColor: colors.emerald400 }]}>
                    <Text style={{ color: fx.awayTeamId === tm.id ? colors.emerald400 : colors.zinc400, fontSize: 11 }}>{tm.name}</Text>
                  </Pressable>
                ))}
              </View>
              {!fx.awayTeamId && (
                <TextInput style={[input as never, { marginTop: 6 }]} placeholder="Away placeholder, e.g. Winner SF2" placeholderTextColor={colors.zinc600} value={fx.awaySourceLabel} onChangeText={(v) => setFx((f) => ({ ...f, awaySourceLabel: v }))} />
              )}
              <Text style={{ color: colors.zinc500, fontSize: 11, marginTop: 8 }}>
                Set the date and court afterwards from the web admin.
              </Text>
              <Pressable
                disabled={busy}
                onPress={async () => {
                  await act({
                    op: "addMatch",
                    tournamentId: t.id,
                    stage: (fx.stage || "LEAGUE").trim().toUpperCase(),
                    roundLabel: fx.roundLabel.trim() || fx.stage || "Match",
                    homeTeamId: fx.homeTeamId || undefined,
                    awayTeamId: fx.awayTeamId || undefined,
                    homeSourceLabel: fx.homeTeamId ? undefined : fx.homeSourceLabel.trim() || undefined,
                    awaySourceLabel: fx.awayTeamId ? undefined : fx.awaySourceLabel.trim() || undefined,
                  });
                  setFx({ stage: "LEAGUE", roundLabel: "", homeTeamId: "", awayTeamId: "", homeSourceLabel: "", awaySourceLabel: "" });
                  setFxOpen(false);
                }}
                style={[styles.chipBtn, { marginTop: 10 }]}
              >
                <Text style={{ color: colors.emerald400, fontSize: 12 }}>Add match</Text>
              </Pressable>
            </View>
          )}

          {/* Organiser & payments — third-party events only. Our own
              tournaments take money from teams instead, which the Teams
              section below already covers. */}
          {t.host === "THIRD_PARTY" && (
            <>
              <Text style={styles.section}>Organiser &amp; payments</Text>
              <View style={styles.card}>
                <Text style={{ color: colors.zinc300, fontWeight: "700" }}>
                  {t.organizerName || "Organiser"}
                </Text>
                {(t.organizerPhone || t.organizerEmail) && (
                  <Text style={{ color: colors.zinc400, fontSize: 12, marginTop: 2 }}>
                    {[t.organizerPhone, t.organizerEmail].filter(Boolean).join(" · ")}
                  </Text>
                )}
                <View style={{ flexDirection: "row", gap: 16, marginTop: 10 }}>
                  <View>
                    <Text style={{ color: colors.zinc500, fontSize: 10 }}>QUOTED</Text>
                    <Text style={{ color: colors.zinc300, fontWeight: "700" }}>
                      ₹{t.quotedAmount.toLocaleString("en-IN")}
                    </Text>
                  </View>
                  <View>
                    <Text style={{ color: colors.zinc500, fontSize: 10 }}>RECEIVED</Text>
                    <Text style={{ color: colors.emerald400, fontWeight: "700" }}>
                      ₹{(ledger?.receivedAmount ?? 0).toLocaleString("en-IN")}
                    </Text>
                  </View>
                  <View>
                    <Text style={{ color: colors.zinc500, fontSize: 10 }}>OUTSTANDING</Text>
                    <Text
                      style={{
                        color: (ledger?.outstanding ?? 0) > 0 ? "#fbbf24" : colors.emerald400,
                        fontWeight: "700",
                      }}
                    >
                      {(ledger?.outstanding ?? 0) > 0
                        ? `₹${(ledger?.outstanding ?? 0).toLocaleString("en-IN")}`
                        : "Settled"}
                    </Text>
                  </View>
                </View>

                {ledger?.payments.map((pmt) => (
                  <Text key={pmt.id} style={{ color: colors.zinc400, fontSize: 11, marginTop: 6 }}>
                    {new Date(pmt.receivedAt).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                    })}{" "}
                    — ₹{pmt.amount.toLocaleString("en-IN")} {pmt.method}
                    {pmt.reference ? ` · ${pmt.reference}` : ""}
                  </Text>
                ))}

                {orgOpen ? (
                  <View style={{ marginTop: 10 }}>
                    <TextInput style={input as never} placeholder="Amount ₹" keyboardType="numeric" placeholderTextColor={colors.zinc600} value={org.amount} onChangeText={(v) => setOrg((f) => ({ ...f, amount: v }))} />
                    <TextInput style={[input as never, { marginTop: 8 }]} placeholder="Method (CASH / BANK_TRANSFER / UPI / CHEQUE)" autoCapitalize="characters" placeholderTextColor={colors.zinc600} value={org.method} onChangeText={(v) => setOrg((f) => ({ ...f, method: v }))} />
                    <TextInput style={[input as never, { marginTop: 8 }]} placeholder="Received on (YYYY-MM-DD)" placeholderTextColor={colors.zinc600} value={org.receivedAt} onChangeText={(v) => setOrg((f) => ({ ...f, receivedAt: v }))} />
                    <TextInput style={[input as never, { marginTop: 8 }]} placeholder="Reference (UTR / cheque no.)" placeholderTextColor={colors.zinc600} value={org.reference} onChangeText={(v) => setOrg((f) => ({ ...f, reference: v }))} />
                    {/* The received date decides the accounting month, so
                        entering last week's cash today must not book to
                        today — say so rather than let it surprise. */}
                    <Text style={{ color: colors.zinc500, fontSize: 11, marginTop: 6 }}>
                      Counts as revenue on the received date.
                    </Text>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                      <Pressable
                        disabled={busy}
                        onPress={async () => {
                          await act(
                            {
                              op: "organizerPay",
                              tournamentId: t.id,
                              amount: Number(org.amount) || 0,
                              method: org.method || "CASH",
                              receivedAt: org.receivedAt,
                              reference: org.reference || undefined,
                            },
                            undefined,
                          );
                          setOrg({ amount: "", method: "CASH", receivedAt: org.receivedAt, reference: "" });
                          setOrgOpen(false);
                          void loadLedger();
                        }}
                        style={styles.chipBtn}
                      >
                        <Text style={{ color: colors.emerald400, fontSize: 12 }}>Save payment</Text>
                      </Pressable>
                      <Pressable onPress={() => setOrgOpen(false)} style={styles.chipBtn}>
                        <Text style={{ color: colors.zinc400, fontSize: 12 }}>Cancel</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable onPress={() => setOrgOpen(true)} style={[styles.chipBtn, { marginTop: 10 }]}>
                    <Text style={{ color: colors.emerald400, fontSize: 12 }}>+ Record payment</Text>
                  </Pressable>
                )}
              </View>
            </>
          )}

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
                      {m === "STATIC_QR" ? "UPI (QR)" : m === "CASH" ? "Cash" : "Free"}
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
              {/* What hours the captain said the team can play. The draw
                  only schedules a team into hours it ticked, so this is
                  the first thing to check when a team goes unscheduled. */}
              {windows.length > 0 && (
                <Text style={{ color: colors.zinc500, fontSize: 11, marginTop: 2 }}>
                  Prefers:{" "}
                  <Text style={{ color: colors.emerald400 }}>
                    {preferredSummary(team.preferredSlotIds, windows)}
                  </Text>
                </Text>
              )}
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
                {/* One chip per method. Most counter money arrives on the
                    printed UPI QR, but this used to record everything as
                    CASH, which made the payment-mode split meaningless. */}
                {team.dueAmount > 0 &&
                  (["CASH", "STATIC_QR"] as const).map((m) => (
                    <Pressable
                      key={m}
                      disabled={busy}
                      onPress={() =>
                        act(
                          { op: "collect", teamId: team.id, amount: team.dueAmount, method: m },
                          `Collect ₹${team.dueAmount} by ${m === "CASH" ? "cash" : "UPI"}?`,
                        )
                      }
                      style={styles.chipBtn}
                    >
                      <Text style={{ color: "#fbbf24", fontSize: 12 }}>
                        ₹{team.dueAmount} {m === "CASH" ? "cash" : "UPI"}
                      </Text>
                    </Pressable>
                  ))}
                {!["REJECTED", "WITHDRAWN"].includes(team.status) && (
                  <Pressable disabled={busy} onPress={() => act({ op: "teamStatus", teamId: team.id, status: "REJECTED" }, "Reject this team? Redeemed points are refunded.")} style={styles.chipBtn}>
                    <Text style={{ color: "#f87171", fontSize: 12 }}>Reject</Text>
                  </Pressable>
                )}
                {/* Archive / Delete — web's team modal has both; the app
                    had neither, so tidying a duplicate entry meant a laptop. */}
                <Pressable
                  disabled={busy}
                  onPress={() => act({ op: "archiveTeam", teamId: team.id, archived: true }, "Archive this team? It stays in the records but leaves the active list.")}
                  style={styles.chipBtn}
                >
                  <Text style={{ color: colors.zinc400, fontSize: 12 }}>Archive</Text>
                </Pressable>
                <Pressable
                  disabled={busy}
                  onPress={() => act({ op: "deleteTeam", teamId: team.id }, "Delete this team permanently? This cannot be undone.")}
                  style={styles.chipBtn}
                >
                  <Text style={{ color: "#f87171", fontSize: 12 }}>Delete</Text>
                </Pressable>
              </View>
            </View>
          ))}

          {/* Fixtures — every match, with the date/court control and delete.
              Both were web-only, so the app could create a fixture it then
              could not place on the calendar or remove. */}
          <Text style={styles.section}>Fixtures ({t.matches.length})</Text>
          {t.matches.map((m) => (
            <View key={m.id} style={styles.card}>
              <Text style={{ color: colors.zinc500, fontSize: 11 }}>
                {m.stage} · {m.roundLabel}
              </Text>
              <Text style={{ color: colors.foreground, fontSize: 13, marginTop: 2 }}>
                {m.homeTeam?.name ?? m.homeSourceLabel ?? "TBD"} vs{" "}
                {m.awayTeam?.name ?? m.awaySourceLabel ?? "TBD"}
              </Text>
              {m.scheduledAt ? (
                <Text style={{ color: colors.emerald400, fontSize: 11, marginTop: 2 }}>
                  {new Date(m.scheduledAt).toLocaleString("en-IN", {
                    day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
                    timeZone: "Asia/Kolkata",
                  })}
                </Text>
              ) : (
                <Text style={{ color: colors.zinc500, fontSize: 11, marginTop: 2 }}>Not scheduled</Text>
              )}

              {schedFor === m.id ? (
                <View style={{ marginTop: 8 }}>
                  {/* Lead with the committed windows: they are what hold
                      these hours off the customer booking grid, so anything
                      outside one is time we are still selling. Semis and the
                      final legitimately sit outside, hence the manual fields
                      below stay usable. */}
                  {windows.length > 0 && (
                    <>
                      <Text style={{ color: colors.zinc500, fontSize: 11 }}>Match window</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4, marginBottom: 8 }}>
                        {windows.map((w) => {
                          const picked =
                            sched.date === w.date.slice(0, 10) &&
                            Number(sched.startHour) >= w.startHour &&
                            Number(sched.startHour) < w.endHour;
                          return (
                            <Pressable
                              key={w.id}
                              onPress={() =>
                                setSched((f) => ({
                                  ...f,
                                  date: w.date.slice(0, 10),
                                  startHour: String(w.startHour),
                                  courtConfigId:
                                    courts.find((c) => c.label === w.courtLabel)?.id || f.courtConfigId,
                                }))
                              }
                              style={[styles.chipBtn, picked && { borderColor: colors.emerald400 }]}
                            >
                              <Text style={{ color: picked ? colors.emerald400 : colors.zinc400, fontSize: 11 }}>
                                {windowLabel(w)}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </>
                  )}
                  <TextInput style={input as never} placeholder="Date YYYY-MM-DD" placeholderTextColor={colors.zinc600} value={sched.date} onChangeText={(v) => setSched((f) => ({ ...f, date: v }))} />
                  <View style={[styles.rowWrap, { marginTop: 8 }]}>
                    <TextInput style={[input as never, { width: 90 }]} placeholder="Hour 0-23" keyboardType="numeric" placeholderTextColor={colors.zinc600} value={sched.startHour} onChangeText={(v) => setSched((f) => ({ ...f, startHour: v }))} />
                    <TextInput style={[input as never, { width: 90 }]} placeholder="Hours" keyboardType="numeric" placeholderTextColor={colors.zinc600} value={sched.hours} onChangeText={(v) => setSched((f) => ({ ...f, hours: v }))} />
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {courts.map((c) => (
                      <Pressable key={c.id} onPress={() => setSched((f) => ({ ...f, courtConfigId: c.id }))} style={[styles.chipBtn, sched.courtConfigId === c.id && { borderColor: colors.emerald400 }]}>
                        <Text style={{ color: sched.courtConfigId === c.id ? colors.emerald400 : colors.zinc400, fontSize: 11 }}>{c.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={[styles.rowWrap, { marginTop: 8 }]}>
                    <Pressable
                      disabled={busy}
                      onPress={async () => {
                        await act({
                          op: "scheduleMatch",
                          matchId: m.id,
                          courtConfigId: sched.courtConfigId,
                          date: sched.date.trim(),
                          startHour: Number(sched.startHour) || 0,
                          hours: Number(sched.hours) || 1,
                        });
                        setSchedFor(null);
                      }}
                      style={styles.chipBtn}
                    >
                      <Text style={{ color: colors.emerald400, fontSize: 12 }}>Save</Text>
                    </Pressable>
                    <Pressable onPress={() => setSchedFor(null)} style={styles.chipBtn}>
                      <Text style={{ color: colors.zinc400, fontSize: 12 }}>Cancel</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={[styles.rowWrap, { marginTop: 8 }]}>
                  <Pressable
                    disabled={busy}
                    onPress={() => {
                      setSchedFor(m.id);
                      setSched({ date: "", startHour: "", hours: "1", courtConfigId: courts[0]?.id ?? "" });
                    }}
                    style={styles.chipBtn}
                  >
                    <Text style={{ color: "#7dd3fc", fontSize: 12 }}>
                      {m.scheduledAt ? "✎ Reschedule" : "📅 Schedule"}
                    </Text>
                  </Pressable>
                  {m.scheduledAt && (
                    <Pressable disabled={busy} onPress={() => act({ op: "unscheduleMatch", matchId: m.id }, "Remove the date and free the court hours?")} style={styles.chipBtn}>
                      <Text style={{ color: colors.zinc400, fontSize: 12 }}>Unschedule</Text>
                    </Pressable>
                  )}
                  {/* Server refuses once a match is played or scored, so this
                      cannot quietly rewrite the points table. */}
                  <Pressable disabled={busy} onPress={() => act({ op: "deleteMatch", matchId: m.id }, "Delete this fixture?")} style={styles.chipBtn}>
                    <Text style={{ color: "#f87171", fontSize: 12 }}>Delete</Text>
                  </Pressable>
                </View>
              )}
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
                  <Pressable
                    // Seed from live scoring when the console already
                    // recorded it — an admin should confirm a scored match,
                    // not retype it. Nulls stay blank for manual entry.
                    onPress={() => {
                      setScoreFor(m.id);
                      setScores({
                        home: m.homeScore != null ? String(m.homeScore) : "",
                        away: m.awayScore != null ? String(m.awayScore) : "",
                      });
                    }}
                    style={[styles.chipBtn, { marginTop: 8, alignSelf: "flex-start" }]}
                  >
                    <Text style={{ color: "#7dd3fc", fontSize: 12 }}>
                      {m.homeScore != null ? "Confirm result" : "Enter result"}
                    </Text>
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
        refreshControl={<RefreshControl refreshing={pullRefreshing} onRefresh={onPullRefresh} tintColor={colors.emerald400} />}
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
