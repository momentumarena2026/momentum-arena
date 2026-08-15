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
import { ReorderableRows } from "../../components/admin/ReorderableRows";
import {
  adminTournamentsApi,
  type AdminCampaignItem,
  type AdminMatchRow,
  type AdminSchedulePlan,
  type AdminSlotWindow,
  type AdminTournamentDetail,
  type OrganizerLedger,
} from "../../lib/admin-tournaments";
import {
  BracketTab,
  LeadersTab,
  OverviewTab,
  PointsTableTab,
} from "./tournament-detail/ReadOnlyTabs";
import { tabsFor, type TabKey } from "./tournament-detail/tabs";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { AdminMoreStackParamList } from "../../navigation/types";
import { usePullToRefresh } from "../../hooks/usePullToRefresh";

import {
  FIXTURE_STAGES,
  FIXTURE_STAGE_LABEL,
  FLOW,
  TRANSITION_LABEL as LABEL,
} from "./tournament-detail/tabs";

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
  /** Which tab is showing. Mirrors the web manage screen exactly. */
  const [tab, setTab] = useState<TabKey>("overview");
  // Slots & Draw
  const [slotForm, setSlotForm] = useState({ date: "", startHour: "", endHour: "", courtConfigId: "", label: "" });
  const [duration, setDuration] = useState("");
  const [plans, setPlans] = useState<AdminSchedulePlan[] | null>(null);
  const [planning, setPlanning] = useState(false);
  // Campaign — loaded on demand, as on the web.
  const [campaign, setCampaign] = useState<AdminCampaignItem[] | null>(null);
  // Settings — the wizard fields the phone can edit.
  const [settings, setSettings] = useState<Record<string, string> | null>(null);

  // Archived events stay out of the way until asked for, as on the web.
  const [showArchived, setShowArchived] = useState(false);
  const { data: list, isLoading, refetch } = useQuery({
    queryKey: ["admin-tournaments", showArchived],
    queryFn: () => adminTournamentsApi.list(showArchived),
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

  /** Resolve a team id for the read-only tabs, which are given ids only. */
  const teamName = useCallback(
    (id: string) => t?.teams.find((x) => x.id === id)?.name ?? "Unknown",
    [t],
  );

  // Pools stop being editable once they are public — the same rule the web
  // tab enforces, so a phone can't quietly reshuffle a revealed draw.
  const poolsLocked = !["REG_OPEN", "REG_CLOSED"].includes(t?.status ?? "");

  const loadCampaign = useCallback(async () => {
    if (!t) return;
    try {
      const res = await adminTournamentsApi.campaignList(t.id);
      setCampaign(res.items);
    } catch {
      // An empty list is a truthful "nothing to show" and keeps the tab
      // usable; a thrown error would strand it on "Loading…" forever.
      setCampaign([]);
    }
  }, [t]);

  // Only when the tab is actually open — most tournaments never show it.
  useEffect(() => {
    if (tab === "campaign" && campaign === null) void loadCampaign();
  }, [tab, campaign, loadCampaign]);

  // Seed the settings form from the server once per tournament, and never
  // again: re-seeding on the 12s poll would wipe what is being typed.
  useEffect(() => {
    if (!t) return;
    setSettings({
      name: t.name,
      totalTeams: String(t.totalTeams),
      entryFee: String(t.entryFee),
      teamsPerPool: String(t.teamsPerPool ?? 0),
      advancePerPool: String(t.advancePerPool ?? 0),
      pointsWin: String(t.pointsWin ?? 3),
      pointsDraw: String(t.pointsDraw ?? 1),
      pointsLoss: String(t.pointsLoss ?? 0),
      oversPerInnings: String(t.oversPerInnings ?? 0),
      wicketsPerInnings: String(t.wicketsPerInnings ?? 10),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.id]);

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

  // Fixture running order. `sequence` is display order only, so this is
  // safe at any point; the local override just keeps the row where it was
  // dropped instead of waiting for the refetch.
  const [fixtureOrder, setFixtureOrder] = useState<Record<string, string[]>>({});

  const reorderFixtures = async (
    tournamentId: string,
    stage: string,
    orderedIds: string[],
  ) => {
    const previous = fixtureOrder[stage];
    setFixtureOrder((o) => ({ ...o, [stage]: orderedIds }));
    try {
      await adminTournamentsApi.action({
        op: "reorderFixtures",
        tournamentId,
        stage,
        orderedIds,
      });
    } catch (e) {
      // Snap back rather than showing an order the server never took.
      setFixtureOrder((o) => {
        const next = { ...o };
        if (previous) next[stage] = previous;
        else delete next[stage];
        return next;
      });
      Alert.alert("Couldn't reorder", e instanceof Error ? e.message : "Try again.");
    }
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
                  act(
                    { op: "transition", tournamentId: t.id, to },
                    to === "REG_OPEN" && t.status === "REG_CLOSED"
                      ? "Reopen registrations? Any closing time already set is cleared, so it stays open until you close it."
                      : `Move to ${LABEL[to] || to}?`,
                  )
                }
                style={[styles.chipBtn, to === "CANCELLED" && { borderColor: "rgba(248,113,113,0.4)" }]}
              >
                <Text style={{ color: to === "CANCELLED" ? "#f87171" : colors.emerald400, fontSize: 12 }}>
                  {to === "REG_OPEN" && t.status === "REG_CLOSED"
                    ? "Reopen Registrations"
                    : LABEL[to] || to}
                </Text>
              </Pressable>
            ))}
            {/* Filing away is about the list, not the lifecycle, so it sits
                with the transitions but is not one of them. The server
                still refuses while the event is live or open. */}
            <Pressable
              disabled={busy}
              onPress={() =>
                act(
                  { op: "archiveTournament", tournamentId: t.id, archived: !t.archivedAt },
                  t.archivedAt
                    ? "Bring this tournament back into the list?"
                    : "Archive this tournament? It keeps every record but leaves the active list here and the public tournaments list.",
                )
              }
              style={styles.chipBtn}
            >
              <Text style={{ color: colors.zinc300, fontSize: 12 }}>
                {t.archivedAt ? "Unarchive" : "Archive"}
              </Text>
            </Pressable>
          </View>

          {/* ══ Tabs — the same set, order and conditions as the web
              manage screen, so an organiser who learned them on a laptop
              finds them where they expect at the venue. The strip scrolls
              because twelve tabs never fit a phone. ══ */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 4, paddingBottom: 2 }}
            style={styles.tabStrip}
          >
            {tabsFor(t).map((tb) => (
              <Pressable
                key={tb.key}
                onPress={() => setTab(tb.key)}
                style={[styles.tabBtn, tab === tb.key && styles.tabBtnOn]}
              >
                <Text
                  style={{
                    color: tab === tb.key ? colors.foreground : colors.zinc400,
                    fontSize: 13,
                    fontWeight: tab === tb.key ? "700" : "400",
                  }}
                >
                  {tb.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {tab === "overview" && <OverviewTab t={t} />}

          {tab === "table" && (
            <PointsTableTab
              groups={detailData?.standings ?? []}
              teamName={teamName}
              isCricket={t.sport === "CRICKET"}
            />
          )}

          {tab === "bracket" && <BracketTab matches={t.matches} teamName={teamName} />}

          {tab === "leaders" && <LeadersTab boards={detailData?.leaderboards ?? []} />}

          {/* Structure ops */}
          {(tab === "pools" || tab === "fixtures") && (
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
          )}

          {/* Hand-entered fixture. Needed whenever the organiser's schedule
              is something generateFixtures cannot derive — a second leg, an
              odd number of semi-finals. Either side may be a real team or a
              placeholder ("Winner SF1") when it is not decided yet. */}
          {fxOpen && tab === "fixtures" && (
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
          {t.host === "THIRD_PARTY" && tab === "organizer" && (
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
          {tab === "teams" && (<>
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
          </>)}

          {/* Fixtures — every match, with the date/court control and delete.
              Both were web-only, so the app could create a fixture it then
              could not place on the calendar or remove. */}
          {tab === "fixtures" && (<>
          <Text style={styles.section}>Fixtures ({t.matches.length})</Text>
          {t.matches.length > 0 && (
            <Text style={{ color: colors.zinc500, fontSize: 11, marginBottom: 6 }}>
              Press and hold a fixture to drag it into a different running order.
            </Text>
          )}
          {FIXTURE_STAGES.map((stage) => {
            const inStage = t.matches.filter((m) => m.stage === stage);
            if (inStage.length === 0) return null;
            const custom = fixtureOrder[stage];
            const ordered = custom
              ? [
                  ...custom.flatMap((id) => {
                    const hit = inStage.find((m) => m.id === id);
                    return hit ? [hit] : [];
                  }),
                  // A fixture added since the drag is appended, not lost.
                  ...inStage.filter((m) => !custom.includes(m.id)),
                ]
              : inStage;
            return (
              <View key={stage}>
                <Text style={{ color: colors.zinc600, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", marginTop: 4, marginBottom: 4 }}>
                  {FIXTURE_STAGE_LABEL[stage] ?? stage}
                </Text>
                <ReorderableRows
                  items={ordered}
                  keyOf={(m) => m.id}
                  // A row with its scheduling form open must not move under
                  // the finger while someone is typing into it.
                  canDrag={(m) => schedFor !== m.id}
                  onReorder={(ids) => void reorderFixtures(t.id, stage, ids)}
                  renderItem={(m) => (
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
                  )}
                />
              </View>
            );
          })}
          </>)}

          {/* ══ Pools & Draw ══ Assigning by hand matters when the random
              deal separates two clubs who travelled together. */}
          {tab === "pools" && (
            <>
              <View style={styles.rowWrap}>
                <Pressable
                  disabled={busy || poolsLocked}
                  onPress={() => act({ op: "createEmptyPools", tournamentId: t.id }, "Replace the current pools with empty ones? Every team becomes unassigned.")}
                  style={styles.chipBtn}
                >
                  <Text style={{ color: colors.zinc300, fontSize: 12 }}>Create empty pools</Text>
                </Pressable>
                {t.pools.length > 0 && (
                  <Pressable
                    disabled={busy || poolsLocked}
                    onPress={() => act({ op: "clearPools", tournamentId: t.id }, "Delete all pools? Every team becomes unassigned.")}
                    style={styles.chipBtn}
                  >
                    <Text style={{ color: "#f87171", fontSize: 12 }}>Clear pools</Text>
                  </Pressable>
                )}
              </View>
              {poolsLocked && (
                <Text style={{ color: colors.zinc500, fontSize: 11 }}>
                  Pools are locked after the reveal.
                </Text>
              )}
              {t.pools.length === 0 ? (
                <View style={styles.card}>
                  <Text style={{ color: colors.zinc500, fontSize: 13 }}>
                    No pools dealt yet. {t.teams.filter((x) => x.status === "CONFIRMED").length} confirmed teams ready.
                  </Text>
                </View>
              ) : (
                t.pools.map((pool) => (
                  <View key={pool.id} style={styles.card}>
                    <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 13 }}>
                      {pool.name}
                    </Text>
                    {t.teams
                      .filter((tm) => tm.status === "CONFIRMED" && tm.pool?.name === pool.name)
                      .map((tm) => (
                        <View key={tm.id} style={[styles.rowBetween, { marginTop: 6 }]}>
                          <Text style={{ color: colors.zinc300, fontSize: 13, flex: 1 }} numberOfLines={1}>
                            {tm.name}
                          </Text>
                          <Pressable
                            disabled={busy || poolsLocked}
                            onPress={() => act({ op: "moveTeamToPool", teamId: tm.id, poolId: null })}
                            style={styles.chipBtn}
                          >
                            <Text style={{ color: colors.zinc400, fontSize: 11 }}>Remove</Text>
                          </Pressable>
                        </View>
                      ))}
                  </View>
                ))
              )}
              {/* Unassigned teams, each with a chip per pool. A drag board
                  is the web affordance; on a phone, tapping the destination
                  is both faster and doesn't fight the scroll view. */}
              {t.pools.length > 0 && (
                <View style={styles.card}>
                  <Text style={{ color: colors.zinc500, fontSize: 11, letterSpacing: 0.6 }}>
                    UNASSIGNED
                  </Text>
                  {t.teams.filter((tm) => tm.status === "CONFIRMED" && !tm.pool).length === 0 ? (
                    <Text style={{ color: colors.zinc600, fontSize: 12, marginTop: 6 }}>
                      Every confirmed team is in a pool.
                    </Text>
                  ) : (
                    t.teams
                      .filter((tm) => tm.status === "CONFIRMED" && !tm.pool)
                      .map((tm) => (
                        <View key={tm.id} style={{ marginTop: 8 }}>
                          <Text style={{ color: colors.zinc300, fontSize: 13 }}>{tm.name}</Text>
                          <View style={[styles.rowWrap, { marginTop: 4 }]}>
                            {t.pools.map((pl) => (
                              <Pressable
                                key={pl.id}
                                disabled={busy || poolsLocked}
                                onPress={() => act({ op: "moveTeamToPool", teamId: tm.id, poolId: pl.id })}
                                style={styles.chipBtn}
                              >
                                <Text style={{ color: "#a78bfa", fontSize: 11 }}>→ {pl.name}</Text>
                              </Pressable>
                            ))}
                          </View>
                        </View>
                      ))
                  )}
                </View>
              )}
            </>
          )}

          {/* ══ Slots & Draw ══ The windows that hold hours off the customer
              booking grid, plus the generator that fills them. */}
          {tab === "slots" && (
            <>
              <View style={styles.card}>
                <Text style={{ color: colors.zinc500, fontSize: 11 }}>Match length (minutes)</Text>
                <View style={[styles.rowWrap, { marginTop: 6, alignItems: "center" }]}>
                  <TextInput
                    style={[input as never, { width: 90 }]}
                    keyboardType="numeric"
                    placeholder={String(t.matchDurationMinutes || 60)}
                    placeholderTextColor={colors.zinc600}
                    value={duration}
                    onChangeText={setDuration}
                  />
                  <Pressable
                    disabled={busy || !duration.trim()}
                    onPress={() =>
                      act({ op: "setMatchDuration", tournamentId: t.id, minutes: Number(duration) || 0 })
                        .then(() => setDuration(""))
                    }
                    style={styles.chipBtn}
                  >
                    <Text style={{ color: colors.emerald400, fontSize: 12 }}>Save</Text>
                  </Pressable>
                </View>
              </View>

              <Text style={styles.section}>Match windows ({windows.length})</Text>
              {windows.map((w) => (
                <View key={w.id} style={styles.card}>
                  <View style={styles.rowBetween}>
                    <Text style={{ color: colors.zinc300, fontSize: 13, flex: 1 }} numberOfLines={1}>
                      {windowLabel(w)}
                    </Text>
                    <Pressable
                      disabled={busy}
                      onPress={() =>
                        act(
                          { op: "deleteSlot", slotId: w.id },
                          "Remove this window? Its hours go back on sale in the customer booking grid.",
                        )
                      }
                      style={styles.chipBtn}
                    >
                      <Text style={{ color: "#f87171", fontSize: 11 }}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              ))}

              <View style={styles.card}>
                <Text style={{ color: colors.zinc500, fontSize: 11 }}>Add a window</Text>
                <TextInput style={[input as never, { marginTop: 6 }]} placeholder="Date YYYY-MM-DD" placeholderTextColor={colors.zinc600} value={slotForm.date} onChangeText={(v) => setSlotForm((f) => ({ ...f, date: v }))} />
                <View style={[styles.rowWrap, { marginTop: 8 }]}>
                  <TextInput style={[input as never, { width: 100 }]} placeholder="Start 0-23" keyboardType="numeric" placeholderTextColor={colors.zinc600} value={slotForm.startHour} onChangeText={(v) => setSlotForm((f) => ({ ...f, startHour: v }))} />
                  <TextInput style={[input as never, { width: 100 }]} placeholder="End 0-24" keyboardType="numeric" placeholderTextColor={colors.zinc600} value={slotForm.endHour} onChangeText={(v) => setSlotForm((f) => ({ ...f, endHour: v }))} />
                </View>
                <View style={[styles.rowWrap, { marginTop: 8 }]}>
                  {courts.map((c) => (
                    <Pressable key={c.id} onPress={() => setSlotForm((f) => ({ ...f, courtConfigId: f.courtConfigId === c.id ? "" : c.id }))} style={[styles.chipBtn, slotForm.courtConfigId === c.id && { borderColor: colors.emerald400 }]}>
                      <Text style={{ color: slotForm.courtConfigId === c.id ? colors.emerald400 : colors.zinc400, fontSize: 11 }}>{c.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={{ color: colors.zinc500, fontSize: 11, marginTop: 8 }}>
                  These hours stop being sellable the moment the window is saved.
                </Text>
                <Pressable
                  disabled={busy || !slotForm.date.trim()}
                  onPress={() =>
                    act({
                      op: "addSlot",
                      tournamentId: t.id,
                      date: slotForm.date.trim(),
                      startHour: Number(slotForm.startHour) || 0,
                      endHour: Number(slotForm.endHour) || 0,
                      courtConfigId: slotForm.courtConfigId || undefined,
                    }).then(() => setSlotForm({ date: "", startHour: "", endHour: "", courtConfigId: "", label: "" }))
                  }
                  style={[styles.chipBtn, { marginTop: 10, alignSelf: "flex-start" }]}
                >
                  <Text style={{ color: colors.emerald400, fontSize: 12 }}>Add window</Text>
                </Pressable>
              </View>

              <Text style={styles.section}>Draw</Text>
              <Pressable
                disabled={busy || planning}
                onPress={async () => {
                  setPlanning(true);
                  try {
                    const res = await adminTournamentsApi.scheduleCandidates(t.id);
                    setPlans(res.plans);
                  } catch (e) {
                    Alert.alert("Couldn't build a draw", e instanceof Error ? e.message : "Try again.");
                  } finally {
                    setPlanning(false);
                  }
                }}
                style={[styles.chipBtn, { alignSelf: "flex-start" }]}
              >
                <Text style={{ color: "#7dd3fc", fontSize: 12 }}>
                  {planning ? "Working…" : "Suggest a draw"}
                </Text>
              </Pressable>
              {plans?.length === 0 && (
                <Text style={{ color: colors.zinc500, fontSize: 12 }}>
                  No workable draw yet — add windows, or confirm more teams.
                </Text>
              )}
              {plans?.map((plan, i) => (
                <View key={plan.label} style={styles.card}>
                  <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 13 }}>
                    {plan.label}
                  </Text>
                  <Text style={{ color: colors.zinc400, fontSize: 12, marginTop: 2 }}>
                    {plan.scheduled} scheduled
                    {plan.unscheduled > 0 ? ` · ${plan.unscheduled} left out` : ""}
                    {/* A compromise means a team is playing an hour it did
                        not tick. Worth naming, because that team will ask. */}
                    {plan.compromises > 0 ? ` · ${plan.compromises} outside a team's picks` : ""}
                  </Text>
                  <Pressable
                    disabled={busy}
                    onPress={() =>
                      act(
                        { op: "approveSchedule", tournamentId: t.id, planIndex: i },
                        `Approve "${plan.label}"? Every fixture gets its date and court, and those hours leave the booking grid.`,
                      ).then(() => setPlans(null))
                    }
                    style={[styles.chipBtn, { marginTop: 8, alignSelf: "flex-start" }]}
                  >
                    <Text style={{ color: colors.emerald400, fontSize: 12 }}>Approve this draw</Text>
                  </Pressable>
                </View>
              ))}
            </>
          )}

          {/* ══ Campaign ══ the autopilot messages for this event. */}
          {tab === "campaign" && (
            <>
              {campaign === null ? (
                <Text style={{ color: colors.zinc500, fontSize: 13 }}>Loading…</Text>
              ) : campaign.length === 0 ? (
                <View style={styles.card}>
                  <Text style={{ color: colors.zinc500, fontSize: 13 }}>
                    No campaign messages for this tournament.
                  </Text>
                </View>
              ) : (
                campaign.map((item) => (
                  <View key={item.id} style={styles.card}>
                    <View style={styles.rowBetween}>
                      <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 13 }}>
                        {item.milestone.replace(/_/g, " ")}
                      </Text>
                      <Text
                        style={{
                          color: item.status === "SENT" ? colors.emerald400 : colors.zinc500,
                          fontSize: 11,
                        }}
                      >
                        {item.kind} · {item.status}
                      </Text>
                    </View>
                    {!!item.title && (
                      <Text style={{ color: colors.zinc300, fontSize: 12, marginTop: 4 }}>
                        {item.title}
                      </Text>
                    )}
                    {!!item.body && (
                      <Text style={{ color: colors.zinc500, fontSize: 12, marginTop: 2 }}>
                        {item.body}
                      </Text>
                    )}
                    <View style={[styles.rowWrap, { marginTop: 8 }]}>
                      <Pressable
                        disabled={busy}
                        onPress={() =>
                          act({
                            op: "campaignUpdate",
                            itemId: item.id,
                            patch: { enabled: !item.enabled },
                          }).then(loadCampaign)
                        }
                        style={styles.chipBtn}
                      >
                        <Text style={{ color: item.enabled ? colors.emerald400 : colors.zinc400, fontSize: 12 }}>
                          {item.enabled ? "Enabled" : "Disabled"}
                        </Text>
                      </Pressable>
                      {item.status !== "SENT" && (
                        <Pressable
                          disabled={busy}
                          onPress={() =>
                            act(
                              { op: "campaignSend", itemId: item.id },
                              "Send this message now? It goes to everyone it targets immediately.",
                            ).then(loadCampaign)
                          }
                          style={styles.chipBtn}
                        >
                          <Text style={{ color: "#7dd3fc", fontSize: 12 }}>Send now</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                ))
              )}
            </>
          )}

          {/* ══ Settings ══ the wizard fields worth changing mid-event. The
              full wizard stays on the web; what is here is what an organiser
              actually needs to fix from the venue. */}
          {tab === "settings" && settings && (
            <View style={styles.card}>
              {([
                ["name", "Name"],
                ["totalTeams", "Total teams"],
                ["entryFee", "Entry fee ₹"],
                ["teamsPerPool", "Teams per pool"],
                ["advancePerPool", "Advance per pool"],
                ["pointsWin", "Points for a win"],
                ["pointsDraw", "Points for a draw"],
                ["pointsLoss", "Points for a loss"],
                ...(t.sport === "CRICKET"
                  ? ([
                      ["oversPerInnings", "Overs / innings"],
                      ["wicketsPerInnings", "Wickets / innings"],
                    ] as const)
                  : []),
              ] as [string, string][]).map(([key, label]) => (
                <View key={key} style={{ marginBottom: 10 }}>
                  <Text style={{ color: colors.zinc500, fontSize: 11 }}>{label}</Text>
                  <TextInput
                    style={[input as never, { marginTop: 4 }]}
                    placeholderTextColor={colors.zinc600}
                    keyboardType={key === "name" ? "default" : "numeric"}
                    value={settings[key] ?? ""}
                    onChangeText={(v) => setSettings((f) => ({ ...(f ?? {}), [key]: v }))}
                  />
                </View>
              ))}
              <Text style={{ color: colors.zinc500, fontSize: 11, marginBottom: 8 }}>
                Saved through the same validation the web wizard uses, so a
                value it would reject is rejected here too.
              </Text>
              <Pressable
                disabled={busy}
                onPress={() =>
                  act({
                    op: "updateTournament",
                    tournamentId: t.id,
                    input: {
                      ...t,
                      ...Object.fromEntries(
                        Object.entries(settings).map(([k, v]) => [
                          k,
                          k === "name" ? v : Number(v) || 0,
                        ]),
                      ),
                    },
                  })
                }
                style={styles.primaryBtn}
              >
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Save settings</Text>
              </Pressable>
            </View>
          )}

          {/* Scores */}
          {tab === "scores" && (<>
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
          {/* Finished matches, with the reopen that used to be web-only.
              A wrong result entered at the venue had to wait for a laptop,
              by which time the points table had already been seen. */}
          {t.matches
            .filter((m) => m.status === "COMPLETED" || m.status === "WALKOVER")
            .map((m) => (
              <View key={m.id} style={styles.card}>
                <Text style={{ color: colors.zinc500, fontSize: 11 }}>{m.roundLabel}</Text>
                <Text style={{ color: colors.foreground, fontSize: 13, marginTop: 2 }}>
                  {m.homeTeam?.name ?? "TBD"} {m.homeScore ?? "-"} — {m.awayScore ?? "-"}{" "}
                  {m.awayTeam?.name ?? "TBD"}
                </Text>
                <Pressable
                  disabled={busy}
                  onPress={() =>
                    act(
                      { op: "reopenMatch", matchId: m.id },
                      "Reopen this match? The result is cleared and the points table recomputes.",
                    )
                  }
                  style={[styles.chipBtn, { marginTop: 8, alignSelf: "flex-start" }]}
                >
                  <Text style={{ color: "#fbbf24", fontSize: 12 }}>Reopen</Text>
                </Pressable>
              </View>
            ))}
          </>)}
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
        <Pressable
          onPress={() => setShowArchived((v) => !v)}
          style={[styles.chipBtn, { alignSelf: "flex-start", marginBottom: 10 }]}
        >
          <Text style={{ color: showArchived ? colors.emerald400 : colors.zinc400, fontSize: 12 }}>
            {showArchived ? "Hide archived" : "Show archived"}
          </Text>
        </Pressable>
        {isLoading && <Skeleton height={90} />}
        {!isLoading && (list?.tournaments.length ?? 0) === 0 && (
          <View style={{ alignItems: "center", paddingVertical: 50, gap: 10 }}>
            <Trophy size={36} color={colors.zinc600} />
            <Text style={{ color: colors.zinc500, fontSize: 13 }}>
              {showArchived
                ? "Nothing here at all yet."
                : "No active tournaments — create one from the web admin, or show the archived ones."}
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
  tabStrip: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginTop: 4,
    // A horizontal ScrollView inside a vertical one needs an explicit
    // height, or it claims the rest of the screen and pushes the tab body
    // off the bottom.
    flexGrow: 0,
  },
  tabBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabBtnOn: { borderBottomColor: colors.emerald500 },
  primaryBtn: {
    backgroundColor: colors.emerald500,
    borderRadius: radius.lg,
    paddingVertical: 12,
    alignItems: "center",
  },
});
