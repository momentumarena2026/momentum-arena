import { useEffect, useMemo, useState } from "react";
import { TournamentBanner } from "../../components/TournamentBanner";
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Trophy, Radio, Users, Plus, Trash2, Lock, CalendarDays, ScrollText } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import { sportTheme } from "../../lib/sport-theme";
import { env } from "../../config/env";
import {
  getTournament,
  getMyTeam,
  updateSquad,
  type MatchLite,
  type TeamLite,
  type StandRow,
  saveSlotPreferences,
} from "../../lib/tournaments";
import { useAuth } from "../../providers/AuthProvider";
import type { AccountStackParamList } from "../../navigation/types";
import { trackTournamentView } from "../../lib/analytics";

type Nav = NativeStackNavigationProp<AccountStackParamList>;
type Rt = RouteProp<AccountStackParamList, "TournamentDetail">;

/** Tournament times are venue wall-clock — always render them in IST. */
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });

const hourLabel = (h: number) => {
  const hr = h % 24;
  const am = hr < 12;
  const v = hr % 12 === 0 ? 12 : hr % 12;
  return `${v}${am ? "am" : "pm"}`;
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const TABS = ["Overview", "Pools", "Table", "Bracket", "Matches", "Leaders"] as const;
type Tab = (typeof TABS)[number];

function Badge({ team, size = 26 }: { team: TeamLite | undefined | null; size?: number }) {
  return (
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
        <Text style={{ color: colors.foreground, fontSize: size * 0.34, fontWeight: "700" }}>
          {(team?.name || "?").slice(0, 2).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

/** Captain's post-registration squad card — registration only needs the
 *  captain; the squad is built (optionally) here. Sends the full desired
 *  list; the server reconciles it stat-safely. */
function SlotPicker({
  teamId,
  windows,
  initial,
  locked,
  onSaved,
}: {
  teamId: string;
  windows: { id: string; date: string; startHour: number; endHour: number; label: string | null }[];
  initial: string[];
  locked: boolean;
  onSaved: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (windows.length === 0) return null;

  return (
    <View style={{ marginTop: 12, gap: 8 }}>
      <Text style={styles.cardTitle}>Your preferred slots</Text>
      <Text style={styles.cardBody}>
        Tick every hour your team can play — pools and match times are built
        around these. Leave all unticked if any time works.
      </Text>
      {windows.map((w) => {
        const hours = Array.from(
          { length: w.endHour - w.startHour },
          (_, i) => w.startHour + i,
        );
        return (
          <View key={w.id} style={{ gap: 6 }}>
            <Text variant="tiny" color={colors.zinc500}>
              {fmtDate(w.date)} · {hourLabel(w.startHour)}–{hourLabel(w.endHour)}
              {w.label ? ` · ${w.label}` : ""}
            </Text>
            <View style={styles.hourGrid}>
              {hours.map((h) => {
                const key = `${w.id}#${h}`;
                const on = picked.includes(key);
                return (
                  <Pressable
                    key={key}
                    disabled={locked}
                    onPress={() =>
                      setPicked((p) =>
                        p.includes(key) ? p.filter((x) => x !== key) : [...p, key],
                      )
                    }
                    style={[styles.hourChip, on && styles.slotRowOn, locked && { opacity: 0.6 }]}
                  >
                    <Text
                      variant="tiny"
                      weight={on ? "700" : "500"}
                      color={on ? colors.emerald400 : colors.zinc300}
                    >
                      {hourLabel(h)}–{hourLabel(h + 1)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
      {locked ? (
        <Text style={styles.cardBody}>
          The schedule is published — contact the venue to change slots.
        </Text>
      ) : (
        <Pressable
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            setMsg(null);
            try {
              const r = await saveSlotPreferences(teamId, picked);
              setMsg(r.error ?? "Saved");
              if (!r.error) onSaved();
            } catch (e) {
              setMsg(e instanceof Error ? e.message : "Couldn't save");
            } finally {
              setBusy(false);
            }
          }}
          style={[styles.registerBtn, { alignSelf: "flex-start", paddingHorizontal: 16 }]}
        >
          <Text style={styles.registerText}>{busy ? "Saving…" : "Save slots"}</Text>
        </Pressable>
      )}
      {msg ? <Text style={styles.cardBody}>{msg}</Text> : null}
    </View>
  );
}

function MySquadCard({ slug }: { slug: string }) {
  const { state: authState } = useAuth();
  const queryClient = useQueryClient();
  const { data: team } = useQuery({
    queryKey: ["myTeam", slug],
    queryFn: () => getMyTeam(slug),
    enabled: !!authState.user,
  });
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<
    { key: string; name: string; phone: string; locked: boolean; isCaptain: boolean }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!team) return null;

  const windows = team.matchSlots ?? [];
  const locked = !!team.slotsLocked;
  const picker = (
    <SlotPicker
      teamId={team.id}
      windows={windows}
      initial={team.preferredSlotIds ?? []}
      locked={locked}
      onSaved={() => queryClient.invalidateQueries({ queryKey: ["myTeam", slug] })}
    />
  );

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await updateSquad(
        team.id,
        rows
          .filter((r) => r.name.trim())
          .map((r) => ({ name: r.name.trim(), phone: r.phone.trim() })),
      );
      if (res.error) setError(res.error);
      else {
        setEditing(false);
        queryClient.invalidateQueries({ queryKey: ["myTeam", slug] });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the squad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={sqStyles.card}>
      <View style={sqStyles.rowBetween}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
          <Users size={15} color={colors.emerald400} />
          <Text style={sqStyles.title} numberOfLines={1}>
            Your Team — {team.name}
          </Text>
        </View>
        <Text style={{ color: team.status === "CONFIRMED" ? colors.emerald400 : "#fbbf24", fontSize: 11, fontWeight: "700" }}>
          {team.status.replace("_", " ")}
        </Text>
      </View>

      {!editing ? (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {team.members.map((m) => (
              <View key={m.id} style={sqStyles.chip}>
                <Text style={{ color: colors.zinc300, fontSize: 12 }}>
                  {m.name}
                  {m.isCaptain ? " ©" : ""}
                  {m.phone ? (
                    <Text style={{ color: colors.zinc500 }}> {m.phone}</Text>
                  ) : null}
                </Text>
              </View>
            ))}
          </View>
          {team.canEditSquad && (
            <Pressable
              onPress={() => {
                setRows(
                  team.members.map((m) => ({
                    key: m.id,
                    name: m.name,
                    phone: m.phone ?? "",
                    locked: m.locked,
                    isCaptain: m.isCaptain,
                  })),
                );
                setError(null);
                setEditing(true);
              }}
              style={sqStyles.editBtn}
            >
              <Text style={{ color: colors.emerald400, fontSize: 13, fontWeight: "600" }}>
                {team.members.length <= 1 ? "+ Add your squad" : "✎ Edit squad"}{" "}
                <Text style={{ color: colors.zinc500, fontSize: 12 }}>
                  ({team.members.length}/{team.maxMembers})
                </Text>
              </Text>
            </Pressable>
          )}
        </>
      ) : (
        <View style={{ marginTop: 10, gap: 8 }}>
          {rows.map((r, i) => (
            <View key={r.key} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <TextInput
                style={[sqStyles.input, { flex: 2 }]}
                placeholder={`Player ${i + 1}`}
                placeholderTextColor={colors.zinc600}
                value={r.name}
                onChangeText={(v) => setRows((arr) => arr.map((x, j) => (j === i ? { ...x, name: v } : x)))}
              />
              <TextInput
                style={[sqStyles.input, { flex: 1 }]}
                placeholder="Phone"
                placeholderTextColor={colors.zinc600}
                keyboardType="phone-pad"
                value={r.phone}
                onChangeText={(v) => setRows((arr) => arr.map((x, j) => (j === i ? { ...x, phone: v } : x)))}
              />
              {r.isCaptain ? (
                <Text style={{ color: "#fbbf24", fontSize: 12, fontWeight: "700" }}>C</Text>
              ) : r.locked ? (
                <Lock size={15} color={colors.zinc600} />
              ) : (
                <Pressable onPress={() => setRows((arr) => arr.filter((_, j) => j !== i))} hitSlop={8}>
                  <Trash2 size={16} color={colors.zinc600} />
                </Pressable>
              )}
            </View>
          ))}
          {rows.length < team.maxMembers && (
            <Pressable
              onPress={() =>
                setRows((arr) => [
                  ...arr,
                  {
                    key: `new-${arr.length}-${Math.random()}`,
                    name: "",
                    phone: "",
                    locked: false,
                    isCaptain: false,
                  },
                ])
              }
              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
            >
              <Plus size={14} color={colors.emerald400} />
              <Text style={{ color: colors.emerald400, fontSize: 13 }}>Add player</Text>
            </Pressable>
          )}
          {error && <Text style={{ color: "#f87171", fontSize: 12 }}>{error}</Text>}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable onPress={save} disabled={busy} style={[sqStyles.saveBtn, busy && { opacity: 0.5 }]}>
              <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 13 }}>
                {busy ? "Saving…" : "Save squad"}
              </Text>
            </Pressable>
            <Pressable onPress={() => setEditing(false)} style={sqStyles.cancelBtn}>
              <Text style={{ color: colors.zinc400, fontSize: 13 }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}
      {picker}
    </View>
  );
}

const sqStyles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    backgroundColor: colors.card,
    padding: 12,
  },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { color: colors.foreground, fontSize: 14, fontWeight: "700", flex: 1 },
  chip: {
    borderRadius: 999,
    backgroundColor: colors.zinc900,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  editBtn: { marginTop: 10 },
  input: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.zinc900,
    color: colors.foreground,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
  },
  saveBtn: {
    backgroundColor: colors.emerald500,
    borderRadius: radius.lg,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  cancelBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: "center",
  },
});

export function TournamentDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { slug } = route.params;
  const [tab, setTab] = useState<Tab>("Overview");

  useEffect(() => {
    trackTournamentView(slug);
  }, [slug]);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["tournament", slug],
    queryFn: () => getTournament(slug),
    refetchInterval: 10000,
  });

  const teams = useMemo(
    () => new Map((data?.teams || []).map((t) => [t.id, t])),
    [data]
  );
  const name = (id: string | null) => (id ? teams.get(id)?.name || "TBD" : null);

  if (isLoading || !data) {
    return (
      <Screen padded={false}>
        <View style={{ padding: 16, gap: 12 }}>
          <Skeleton height={140} />
          <Skeleton height={80} />
          <Skeleton height={200} />
        </View>
      </Screen>
    );
  }

  const t = data.tournament;
  const liveOk =
    t.liveScoringEnabled && ["BOTH", "APP_ONLY"].includes(t.liveScreenPlatform);
  const liveMatches = data.matches.filter((m) => m.status === "LIVE");
  const visibleTabs = TABS.filter((x) => {
    if (x === "Pools" && t.format !== "POOLS_KNOCKOUT") return false;
    if (x === "Table" && t.format === "KNOCKOUT") return false;
    // A league has no knockout stage, so there's no bracket to draw —
    // same rule the web centre applies.
    if (x === "Bracket" && t.format === "LEAGUE") return false;
    return true;
  });

  const matchRow = (m: MatchLite, i: number) => {
    const inner = (
      <Animated.View entering={FadeInDown.delay(i * 40)} style={[styles.matchCard, m.status === "LIVE" && styles.matchLive]}>
        <View style={styles.rowBetween}>
          <Text style={styles.matchLabel}>{m.roundLabel}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {m.courtConfig && <Text style={styles.matchLabel}>{m.courtConfig.label}</Text>}
            {m.scheduledAt && (
              <Text style={styles.matchLabel}>
                {new Date(m.scheduledAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}
              </Text>
            )}
            {m.status === "LIVE" && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                <Radio size={11} color="#f87171" />
                <Text style={{ color: "#f87171", fontSize: 11, fontWeight: "700" }}>LIVE</Text>
              </View>
            )}
          </View>
        </View>
        {(
          [
            { n: name(m.homeTeamId) || m.homeSourceLabel || "TBD", id: m.homeTeamId, s: m.homeScore, note: m.homeScoreNote },
            { n: name(m.awayTeamId) || m.awaySourceLabel || "TBD", id: m.awayTeamId, s: m.awayScore, note: m.awayScoreNote },
          ] as const
        ).map((side, j) => (
          <View key={j} style={[styles.rowBetween, { marginTop: 6 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
              <Badge team={side.id ? teams.get(side.id) : null} size={22} />
              <Text
                numberOfLines={1}
                style={{
                  color: m.winnerTeamId && side.id === m.winnerTeamId ? colors.emerald400 : side.id ? colors.zinc300 : colors.zinc500,
                  fontWeight: m.winnerTeamId && side.id === m.winnerTeamId ? "700" : "400",
                  fontSize: 14,
                  flex: 1,
                  fontStyle: side.id ? "normal" : "italic",
                }}
              >
                {side.n}
              </Text>
            </View>
            <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 14 }}>
              {side.note || (side.s != null ? String(side.s) : "")}
            </Text>
          </View>
        ))}
      </Animated.View>
    );
    // Any decided match opens its match centre (scorecard + commentary).
    return m.homeTeamId && m.awayTeamId ? (
      <Pressable key={m.id} onPress={() => navigation.navigate("TournamentMatch", { matchId: m.id, slug })}>
        {inner}
      </Pressable>
    ) : (
      <View key={m.id}>{inner}</View>
    );
  };

  /** Pinned live card — the first thing a follower should see. */
  const liveCard = (m: MatchLite) => {
    const home = m.homeTeamId ? teams.get(m.homeTeamId) : null;
    const away = m.awayTeamId ? teams.get(m.awayTeamId) : null;
    const st = (m.liveState || null) as
      | { sport?: string; innings?: { teamId: string; runs: number; wickets: number; balls: number }[]; target?: number | null }
      | null;
    const line = (teamId: string | null, fallback: number | null) => {
      const inn = st?.sport === "CRICKET" && teamId ? st.innings?.find((x) => x.teamId === teamId) : null;
      return inn ? `${inn.runs}/${inn.wickets}` : String(fallback ?? 0);
    };
    const ov = (teamId: string | null) => {
      const inn = st?.sport === "CRICKET" && teamId ? st.innings?.find((x) => x.teamId === teamId) : null;
      return inn ? ` (${Math.floor(inn.balls / 6)}.${inn.balls % 6})` : "";
    };
    return (
      <Pressable
        key={m.id}
        onPress={() => navigation.navigate("TournamentMatch", { matchId: m.id, slug })}
        style={styles.liveCard}
      >
        <View style={styles.rowBetween}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Radio size={12} color="#f87171" />
            <Text style={{ color: "#f87171", fontSize: 11, fontWeight: "800" }}>LIVE NOW</Text>
          </View>
          <Text style={{ color: colors.zinc500, fontSize: 11 }}>{m.roundLabel}</Text>
        </View>
        {[
          { t: home, id: m.homeTeamId, s: m.homeScore, note: m.homeScoreNote },
          { t: away, id: m.awayTeamId, s: m.awayScore, note: m.awayScoreNote },
        ].map((side, i) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
            <Badge team={side.t} size={26} />
            <Text style={{ color: colors.foreground, fontSize: 14, flex: 1 }} numberOfLines={1}>
              {side.t?.name || "TBD"}
            </Text>
            <Text style={{ color: colors.emerald400, fontSize: 18, fontWeight: "800" }}>
              {side.note || line(side.id, side.s)}
              <Text style={{ color: colors.zinc500, fontSize: 11, fontWeight: "400" }}>{ov(side.id)}</Text>
            </Text>
          </View>
        ))}
        <Text style={styles.liveCta}>
          {st?.target ? `Target ${st.target} · ` : ""}Tap for the live scorecard →
        </Text>
      </Pressable>
    );
  };

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.emerald400} />}
      >
        {/* Banner — the admin's uploaded image, else the sport's stock
            photo. Web leads with this; the app rendered no image at all. */}
        <TournamentBanner
          uri={t.bannerImageUrl || `${env.apiUrl}${sportTheme(t.sport).imagePath}`}
          style={styles.banner}
        >
          <View style={[styles.bannerFade, styles.bannerFadeSoft]} />
          <View style={[styles.bannerFade, styles.bannerFadeDeep]} />
        </TournamentBanner>

        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.title}>{t.name}</Text>
          <Text style={styles.subtitle}>
            {t.sport} · {t.format === "POOLS_KNOCKOUT" ? "Pools → Knockout" : t.format} ·{" "}
            {data.teams.length}/{t.totalTeams} teams
          </Text>
          {t.prizePool ? (
            <View style={styles.prizeRow}>
              <Trophy size={15} color="#fbbf24" />
              <Text style={styles.prizeText}>₹{t.prizePool.toLocaleString("en-IN")} prize pool</Text>
            </View>
          ) : null}
          {t.status === "PUBLISHED" && (
            <Text style={{ color: "#7dd3fc", fontSize: 13, marginTop: 4 }}>
              {t.regOpenAt && new Date(t.regOpenAt) > new Date()
                ? `Registrations open ${new Date(t.regOpenAt).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}`
                : "Registrations opening soon"}
            </Text>
          )}
          {t.status === "REG_OPEN" && (
            <Pressable
              onPress={() => navigation.navigate("TournamentRegister", { slug })}
              style={({ pressed }) => [styles.registerBtn, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.registerText}>Register your team</Text>
            </Pressable>
          )}
        </View>

        {/* Captain's squad manager (post-registration, optional) */}
        <MySquadCard slug={slug} />

        {/* LIVE card(s), pinned above the tabs */}
        {liveMatches.map((m) => liveCard(m))}
        {liveOk && liveMatches.length > 0 && (
          <Pressable
            onPress={() => navigation.navigate("TournamentLive", { matchId: liveMatches[0]!.id, slug })}
            style={{ alignSelf: "center" }}
          >
            <Text style={{ color: "#f87171", fontSize: 12, textDecorationLine: "underline" }}>
              Open the big-screen view →
            </Text>
          </Pressable>
        )}

        {/* Tabs */}
        <View style={styles.tabs}>
          {visibleTabs.map((x) => (
            <Pressable key={x} onPress={() => setTab(x)} style={[styles.tab, tab === x && styles.tabActive]}>
              <Text style={[styles.tabText, tab === x && { color: colors.foreground }]}>{x}</Text>
            </Pressable>
          ))}
        </View>

        {/* Overview */}
        {tab === "Overview" && (
          <View style={{ gap: 8 }}>
            {/* About / prizes / rules / key facts — all of this was on the
                web page and none of it reached the app, which is what
                "information is missing" meant. */}
            {t.description ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>About</Text>
                <Text style={styles.cardBody}>{t.description}</Text>
              </View>
            ) : null}

            <View style={styles.card}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <CalendarDays size={15} color={colors.emerald400} />
                <Text style={styles.cardTitle}>Details</Text>
              </View>
              <View style={{ marginTop: 8, gap: 6 }}>
                {t.startDate && (
                  <DetailRow
                    label="Starts"
                    value={fmtDate(t.startDate)}
                  />
                )}
                {t.endDate && <DetailRow label="Ends" value={fmtDate(t.endDate)} />}
                {t.regCloseAt && (
                  <DetailRow label="Registration closes" value={fmtDate(t.regCloseAt)} />
                )}
                <DetailRow label="Squad size" value={`Up to ${t.membersPerTeamMax} players`} />
                <DetailRow
                  label="Entry fee"
                  value={
                    t.feeMode === "FREE"
                      ? "Free entry"
                      : `₹${t.entryFee.toLocaleString("en-IN")} per team${
                          t.feeMode === "ADVANCE" ? ` (₹${Math.round((t.entryFee * t.advancePct) / 100).toLocaleString("en-IN")} to book)` : ""
                        }`
                  }
                />
              </View>
            </View>

            {/* Pre-decided match windows — same information the web page
                shows, so a team knows when it would have to turn up.
                Semi-final and final are scheduled separately. */}
            {Array.isArray(data.matchSlots) && data.matchSlots.length > 0 ? (
              <View style={styles.card}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <CalendarDays size={15} color={colors.emerald400} />
                  <Text style={styles.cardTitle}>Match windows</Text>
                </View>
                <Text style={[styles.cardBody, { marginTop: 4 }]}>
                  Pool matches run inside these windows. Semi-final and final
                  are scheduled separately once the pools finish.
                </Text>
                <View style={{ marginTop: 8, gap: 6 }}>
                  {data.matchSlots.map((w) => (
                    <DetailRow
                      key={w.id}
                      label={`${fmtDate(w.date)}${w.label ? ` · ${w.label}` : ""}`}
                      value={`${hourLabel(w.startHour)} – ${hourLabel(w.endHour)}`}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            {Array.isArray(t.prizes) &&
            t.prizes.filter((p) => p && p.place && p.label).length > 0 ? (
              <View style={styles.card}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Trophy size={15} color="#fbbf24" />
                  <Text style={styles.cardTitle}>Prizes</Text>
                </View>
                {t.prizePool ? (
                  <Text style={styles.prizePool}>
                    ₹{t.prizePool.toLocaleString("en-IN")}
                    <Text style={styles.prizePoolNote}>  total pool</Text>
                  </Text>
                ) : null}
                <View style={{ marginTop: 8, gap: 6 }}>
                  {t.prizes.map((p, i) => (
                    // `label` is free text the admin types ("₹3,000 + Trophy",
                    // or a pass name) — never a number. Rendering it as
                    // currency showed ₹0 for every prize.
                    <DetailRow key={`${p.place}-${i}`} label={p.place} value={p.label} />
                  ))}
                </View>
              </View>
            ) : null}

            {t.rules ? (
              <View style={styles.card}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <ScrollText size={15} color={colors.emerald400} />
                  <Text style={styles.cardTitle}>Rules</Text>
                </View>
                <Text style={[styles.cardBody, { marginTop: 6 }]}>{t.rules}</Text>
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Format</Text>
              <Text style={styles.cardBody}>
                {t.format === "POOLS_KNOCKOUT"
                  ? `${t.poolCount} pools of ${t.teamsPerPool} teams play round-robin. Top ${t.advancePerPool} from each pool advance to the knockouts.`
                  : t.format === "LEAGUE"
                    ? `All ${t.totalTeams} teams play a round-robin league — top of the table wins.`
                    : `Straight knockout — lose and you're out. ${t.totalTeams} teams, one champion.`}
              </Text>
              <Text style={[styles.cardBody, { marginTop: 8 }]}>
                Squad size: up to {t.membersPerTeamMax} players — add yours any
                time after registering.
              </Text>
              {t.format !== "LEAGUE" && t.thirdPlaceMatch ? (
                <Text style={[styles.cardBody, { marginTop: 4, color: colors.zinc500 }]}>
                  Includes a 3rd-place match.
                </Text>
              ) : null}
            </View>
            <View style={styles.card}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Users size={15} color={colors.emerald400} />
                <Text style={styles.cardTitle}>Teams ({data.teams.length})</Text>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                {data.teams.map((team) => (
                  <View key={team.id} style={styles.teamChip}>
                    <Badge team={team} size={20} />
                    <Text style={{ color: colors.zinc300, fontSize: 12 }}>{team.name}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}

        {/* Pools */}
        {tab === "Pools" &&
          (!data.poolsRevealed ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>✨ Pool reveal coming up</Text>
              <Text style={styles.cardBody}>
                {t.revealAt
                  ? `The draw goes live ${new Date(t.revealAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })} — watch this space!`
                  : "The draw will be revealed soon."}
              </Text>
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              {data.pools.map((pool, pi) => (
                <Animated.View key={pool.id} entering={FadeInDown.delay(pi * 90)} style={styles.card}>
                  <Text style={[styles.cardTitle, { color: "#a78bfa" }]}>{pool.name}</Text>
                  <View style={{ gap: 8, marginTop: 8 }}>
                    {data.teams
                      .filter((x) => x.poolId === pool.id)
                      .map((team, ti) => (
                        <Animated.View
                          key={team.id}
                          entering={FadeInDown.delay(pi * 90 + ti * 60)}
                          style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
                        >
                          <Badge team={team} size={28} />
                          <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{team.name}</Text>
                        </Animated.View>
                      ))}
                  </View>
                </Animated.View>
              ))}
            </View>
          ))}

        {/* Table */}
        {tab === "Table" && (
          <View style={{ gap: 12 }}>
            {data.standings.length === 0 && (
              <View style={styles.card}>
                <Text style={styles.cardBody}>The points table appears once pools are revealed.</Text>
              </View>
            )}
            {data.standings.map((s) => (
              <View key={s.poolId || "league"} style={styles.card}>
                {s.poolName && <Text style={[styles.cardTitle, { color: "#a78bfa" }]}>{s.poolName}</Text>}
                <View style={[styles.tRow, { marginTop: s.poolName ? 8 : 0 }]}>
                  {["#", "Team", "P", "W", "L", "+/−", "Pts"].map((h, i) => (
                    <Text key={h} style={[styles.tHead, i === 1 && { flex: 1, textAlign: "left" }]}>
                      {h}
                    </Text>
                  ))}
                </View>
                {(s.rows as StandRow[]).map((r, i) => {
                  const q = t.format === "POOLS_KNOCKOUT" && i < t.advancePerPool;
                  return (
                    <View key={r.teamId} style={[styles.tRow, q && { backgroundColor: colors.emerald500_05, borderRadius: 8 }]}>
                      <Text style={[styles.tCell, q && { color: colors.emerald400, fontWeight: "700" }]}>{i + 1}</Text>
                      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Badge team={teams.get(r.teamId)} size={20} />
                        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, flex: 1 }}>
                          {teams.get(r.teamId)?.name || "—"}
                        </Text>
                      </View>
                      <Text style={styles.tCell}>{r.played}</Text>
                      <Text style={styles.tCell}>{r.won}</Text>
                      <Text style={styles.tCell}>{r.lost}</Text>
                      <Text style={[styles.tCell, { color: r.scoreDiff > 0 ? colors.emerald400 : r.scoreDiff < 0 ? "#f87171" : colors.zinc400 }]}>
                        {r.scoreDiff > 0 ? "+" : ""}
                        {r.scoreDiff}
                      </Text>
                      <Text style={[styles.tCell, { color: colors.foreground, fontWeight: "700" }]}>{r.points}</Text>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        )}

        {/* Matches */}
        {/* Bracket — knockout stages side by side, scrolled horizontally
            so a phone can follow R16 → Final without squashing the cards.
            Derived from `matches`, exactly like the web centre. */}
        {tab === "Bracket" && (() => {
          const STAGE_TITLE: Record<string, string> = {
            R16: "Round of 16",
            QF: "Quarter Finals",
            SF: "Semi Finals",
            FINAL: "Final",
          };
          const stages = ["R16", "QF", "SF", "FINAL"].filter((st) =>
            data.matches.some((m) => m.stage === st),
          );
          const third = data.matches.filter((m) => m.stage === "THIRD_PLACE");
          if (stages.length === 0) {
            return (
              <View style={styles.card}>
                <Text style={styles.cardBody}>
                  The bracket appears once fixtures are generated.
                </Text>
              </View>
            );
          }
          return (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 12, paddingRight: 12 }}
            >
              {stages.map((st) => (
                <View key={st} style={{ width: 260, gap: 8 }}>
                  <Text style={styles.bracketStage}>{STAGE_TITLE[st]}</Text>
                  {data.matches
                    .filter((m) => m.stage === st)
                    .map((m, i) => matchRow(m, i))}
                  {st === "FINAL" && third.length > 0 && (
                    <>
                      <Text style={styles.bracketStage}>3rd Place</Text>
                      {third.map((m, i) => matchRow(m, i))}
                    </>
                  )}
                </View>
              ))}
            </ScrollView>
          );
        })()}

        {tab === "Matches" && (
          <View style={{ gap: 8 }}>
            {data.matches.length === 0 && (
              <View style={styles.card}>
                <Text style={styles.cardBody}>Fixtures coming soon.</Text>
              </View>
            )}
            {data.matches.map((m, i) => matchRow(m, i))}
          </View>
        )}

        {/* Leaders */}
        {tab === "Leaders" && (
          <View style={{ gap: 12 }}>
            {data.leaderboards.length === 0 && (
              <View style={styles.card}>
                <Text style={styles.cardBody}>Player leaderboards appear once matches are scored.</Text>
              </View>
            )}
            {data.leaderboards.map((lb) => {
              const max = Math.max(1, ...lb.rows.map((r) => r.value));
              return (
                <View key={lb.key} style={styles.card}>
                  <Text style={styles.cardTitle}>🥇 Most {lb.label}</Text>
                  <View style={{ gap: 8, marginTop: 8 }}>
                    {lb.rows.map((r, i) => (
                      <View key={r.memberId}>
                        <View style={styles.rowBetween}>
                          <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: i === 0 ? "700" : "400" }}>
                            {i + 1}. {r.name}
                          </Text>
                          <Text style={{ color: colors.emerald400, fontWeight: "700", fontSize: 13 }}>{r.value}</Text>
                        </View>
                        <View style={styles.barTrack}>
                          <View
                            style={[
                              styles.barFill,
                              { width: `${(r.value / max) * 100}%`, backgroundColor: r.teamColor || colors.emerald500 },
                            ]}
                          />
                        </View>
                        <Text style={{ color: colors.zinc500, fontSize: 11 }}>{r.teamName}</Text>
                      </View>
                    ))}
                    {lb.rows.length === 0 && <Text style={styles.cardBody}>No entries yet.</Text>}
                  </View>
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
  // padded={false} on <Screen> — this is the ONLY horizontal
  // padding, matching camps/passes at spacing 5. Leaving Screen
  // padded stacked 24 + 16 and made these screens 40px a side.
  content: { padding: spacing["5"], gap: 12, paddingBottom: 32 },
  // No height here on purpose: TournamentBanner sets the box from the
  // artwork's own ratio, so a fixed 150 would put the crop straight back.
  banner: {
    borderRadius: radius.xl,
    position: "relative",
  },
  bannerFade: { position: "absolute", left: 0, right: 0, bottom: 0 },
  bannerFadeSoft: { height: 90, backgroundColor: "rgba(9,9,11,0.35)" },
  bannerFadeDeep: { height: 40, backgroundColor: "rgba(9,9,11,0.6)" },
  hero: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 16,
    gap: 4,
  },
  title: { color: colors.foreground, fontSize: 20, fontWeight: "800" },
  subtitle: { color: colors.zinc400, fontSize: 13 },
  prizeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  prizeText: { color: "#fbbf24", fontSize: 14, fontWeight: "700" },
  registerBtn: {
    marginTop: 12,
    backgroundColor: colors.emerald500,
    borderRadius: radius.lg,
    paddingVertical: 13,
    alignItems: "center",
  },
  registerText: { color: colors.foreground, fontWeight: "700", fontSize: 15 },
  liveStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.4)",
    backgroundColor: "rgba(248,113,113,0.08)",
    borderRadius: radius.lg,
    padding: 12,
  },
  liveStripText: { color: "#fca5a5", fontSize: 14, fontWeight: "600", flex: 1 },
  liveCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.45)",
    backgroundColor: "rgba(248,113,113,0.06)",
    padding: 14,
  },
  liveCta: {
    color: colors.zinc400,
    fontSize: 11,
    textAlign: "center",
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(248,113,113,0.2)",
  },
  tabs: { flexDirection: "row", gap: 4, flexWrap: "wrap" },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.emerald500_10, borderColor: colors.emerald500_30 },
  tabText: { color: colors.zinc400, fontSize: 13 },
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
  },
  cardTitle: { color: colors.foreground, fontSize: 14, fontWeight: "700" },
  cardBody: { color: colors.zinc400, fontSize: 13, lineHeight: 19, marginTop: 4 },
  teamChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    backgroundColor: colors.zinc900,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  prizePool: {
    marginTop: 6,
    fontSize: 22,
    fontWeight: "800",
    color: colors.foreground,
  },
  prizePoolNote: { fontSize: 12, fontWeight: "400", color: colors.zinc500 },
  hourGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  hourChip: {
    minWidth: 92,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.zinc700,
    borderRadius: radius.lg,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  slotRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.zinc700,
    borderRadius: radius.lg,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  slotRowOn: {
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_10,
  },
  slotBox: {
    width: 16, height: 16, borderRadius: 4,
    borderWidth: 1, borderColor: colors.zinc600,
    alignItems: "center", justifyContent: "center",
  },
  slotBoxOn: { backgroundColor: colors.emerald400, borderColor: colors.emerald400 },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  detailLabel: { color: colors.zinc500, fontSize: 13, flexShrink: 0 },
  detailValue: {
    color: colors.zinc300,
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
    textAlign: "right",
  },
  bracketStage: {
    textAlign: "center",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.zinc400,
  },
  matchCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
  },
  matchLive: { borderColor: "rgba(248,113,113,0.5)" },
  matchLabel: { color: colors.zinc500, fontSize: 11 },
  tRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, gap: 4 },
  tHead: { width: 30, textAlign: "center", color: colors.zinc500, fontSize: 11 },
  tCell: { width: 30, textAlign: "center", color: colors.zinc300, fontSize: 12 },
  barTrack: { height: 5, borderRadius: 3, backgroundColor: colors.zinc800, marginVertical: 3, overflow: "hidden" },
  barFill: { height: 5, borderRadius: 3 },
});
