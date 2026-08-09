"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trackTournamentView } from "@/lib/analytics";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import confetti from "canvas-confetti";
import { Loader2, Radio, Trophy, Medal, CalendarDays, Table2, GitBranch, Sparkles } from "lucide-react";

// ── payload types (from /api/tournaments/[slug]/public) ─────────────
type TeamLite = { id: string; name: string; color: string | null; logoUrl: string | null; poolId: string | null };
type Pool = { id: string; name: string; order: number };
type StandRow = {
  teamId: string; played: number; won: number; drawn: number; lost: number;
  scoreFor: number; scoreAgainst: number; scoreDiff: number; points: number;
  nrr: number | null; nrrMatches: number;
};

/** Cricket convention: signed, three decimals. "—" when no match this team
 *  played was scored ball-by-ball, since there is no run rate to state. */
function formatNrr(n: number | null): string {
  if (n == null) return "—";
  const v = n.toFixed(3);
  return n > 0 ? `+${v}` : v.replace("-", "\u2212");
}
type MatchLite = {
  id: string; stage: string; status: string; sequence: number; roundLabel: string | null;
  poolId: string | null; homeTeamId: string | null; awayTeamId: string | null;
  homeSourceLabel: string | null; awaySourceLabel: string | null;
  homeScore: number | null; awayScore: number | null;
  homeScoreNote: string | null; awayScoreNote: string | null;
  isDraw: boolean; winnerTeamId: string | null; scheduledAt: string | null;
  liveState: unknown;
  courtConfig: { label: string } | null; playerOfMatch: { name: string } | null;
};
type Payload = {
  tournament: {
    id: string; slug: string; name: string; sport: string; status: string; format: string;
    advancePerPool: number; revealAt: string | null; liveScoringEnabled: boolean;
    liveScreenPlatform: string;
  };
  poolsRevealed: boolean;
  pools: Pool[];
  teams: TeamLite[];
  standings: { poolId: string | null; poolName: string | null; rows: StandRow[] }[];
  matches: MatchLite[];
  leaderboards: { key: string; label: string; rows: { memberId: string; name: string; teamName: string; teamColor: string | null; value: number }[] }[];
};

export type CenterTab = "reveal" | "table" | "bracket" | "matches" | "leaders";

const TABS: { key: CenterTab; label: string; icon: typeof Table2 }[] = [
  { key: "reveal", label: "Pools", icon: Sparkles },
  { key: "table", label: "Points Table", icon: Table2 },
  { key: "bracket", label: "Bracket", icon: GitBranch },
  { key: "matches", label: "Matches", icon: CalendarDays },
  { key: "leaders", label: "Leaders", icon: Medal },
];

function TeamBadge({ team, size = 32 }: { team: TeamLite | undefined | null; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white"
      style={{ backgroundColor: team?.color || "#3f3f46", width: size, height: size, fontSize: size * 0.34 }}
    >
      {team?.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={team.logoUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        (team?.name || "?").slice(0, 2).toUpperCase()
      )}
    </span>
  );
}

// ── Countdown ───────────────────────────────────────────────────────
function Countdown({ target }: { target: string }) {
  const [left, setLeft] = useState(() => Math.max(0, new Date(target).getTime() - Date.now()));
  useEffect(() => {
    const iv = setInterval(() => setLeft(Math.max(0, new Date(target).getTime() - Date.now())), 1000);
    return () => clearInterval(iv);
  }, [target]);
  const d = Math.floor(left / 86400000);
  const h = Math.floor((left % 86400000) / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);
  const cells: [string, number][] = d > 0 ? [["days", d], ["hrs", h], ["min", m], ["sec", s]] : [["hrs", h], ["min", m], ["sec", s]];
  return (
    <div className="flex justify-center gap-3">
      {cells.map(([label, v]) => (
        <div key={label} className="w-20 rounded-2xl border border-violet-500/30 bg-violet-500/10 p-3 text-center">
          <motion.div
            key={v}
            initial={{ y: -8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="text-3xl font-bold tabular-nums text-white"
          >
            {String(v).padStart(2, "0")}
          </motion.div>
          <div className="mt-1 text-[10px] uppercase tracking-widest text-violet-300">{label}</div>
        </div>
      ))}
    </div>
  );
}

export function TournamentCenter({ slug, initialTab }: { slug: string; initialTab: CenterTab }) {
  // GA4 funnel: hub → detail → register → live. The app half shipped with
  // the module but the web half was never wired, so these screens reported
  // nothing. Fires once per slug, not per tab switch.
  useEffect(() => {
    trackTournamentView(slug);
  }, [slug]);
  const [data, setData] = useState<Payload | null>(null);
  const [tab, setTab] = useState<CenterTab>(initialTab);
  const [drawPlayed, setDrawPlayed] = useState(false);
  const [drawStep, setDrawStep] = useState(-1); // index into the draw order during the ceremony
  const wasUnrevealed = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tournaments/${slug}/public`, { cache: "no-store" });
      if (!res.ok) return;
      const p = (await res.json()) as Payload;
      setData((prev) => {
        if (prev && !prev.poolsRevealed) wasUnrevealed.current = true;
        return p;
      });
    } catch {
      /* transient */
    }
  }, [slug]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 8000);
    return () => clearInterval(iv);
  }, [load]);

  const teams = useMemo(() => new Map((data?.teams || []).map((t) => [t.id, t])), [data]);

  // Draw ceremony: ordered list of (team, pool) reveals, pool-by-pool round-robin.
  const drawOrder = useMemo(() => {
    if (!data?.poolsRevealed) return [];
    const byPool = new Map<string, TeamLite[]>();
    for (const p of data.pools) byPool.set(p.id, data.teams.filter((t) => t.poolId === p.id));
    const order: { team: TeamLite; poolId: string }[] = [];
    let added = true;
    let idx = 0;
    while (added) {
      added = false;
      for (const p of data.pools) {
        const list = byPool.get(p.id) || [];
        if (idx < list.length) {
          order.push({ team: list[idx], poolId: p.id });
          added = true;
        }
      }
      idx++;
    }
    return order;
  }, [data]);

  const playDraw = useCallback(() => {
    setDrawPlayed(true);
    setDrawStep(-1);
    let i = 0;
    const step = () => {
      setDrawStep(i);
      i += 1;
      if (i <= drawOrder.length) {
        setTimeout(step, i === drawOrder.length ? 500 : 650);
      }
      if (i === drawOrder.length) {
        setTimeout(() => {
          confetti({ particleCount: 140, spread: 75, origin: { y: 0.35 } });
          confetti({ particleCount: 80, angle: 60, spread: 55, origin: { x: 0 } });
          confetti({ particleCount: 80, angle: 120, spread: 55, origin: { x: 1 } });
        }, 300);
      }
    };
    setTimeout(step, 400);
  }, [drawOrder.length]);

  // Auto-play the ceremony for viewers waiting on the reveal screen when the flip lands.
  useEffect(() => {
    if (data?.poolsRevealed && wasUnrevealed.current && !drawPlayed && tab === "reveal") {
      playDraw();
    }
  }, [data?.poolsRevealed, drawPlayed, tab, playDraw]);

  if (!data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  const t = data.tournament;
  // NRR is a cricket statistic; the column is hidden for every other sport,
  // which already reads goal/point difference from the +/− column.
  const isCricket = t.sport === "CRICKET";
  const liveMatches = data.matches.filter((m) => m.status === "LIVE");
  const showLiveLinks =
    t.liveScoringEnabled && ["BOTH", "APP_ONLY", "WEB_ONLY"].includes(t.liveScreenPlatform);

  const name = (id: string | null) => (id ? teams.get(id)?.name || "TBD" : null);

  const matchCard = (m: MatchLite, compact = false) => {
    const homeN = name(m.homeTeamId) || m.homeSourceLabel || "TBD";
    const awayN = name(m.awayTeamId) || m.awaySourceLabel || "TBD";
    const winner = m.winnerTeamId;
    const inner = (
      <div className={`rounded-xl border bg-zinc-900/70 p-3 ${m.status === "LIVE" ? "border-red-500/50" : "border-zinc-800"}`}>
        <div className="flex items-center justify-between text-[11px] text-zinc-500">
          <span>{m.roundLabel}</span>
          <span className="flex items-center gap-2">
            {m.courtConfig && <span>{m.courtConfig.label}</span>}
            {m.scheduledAt && (
              <span>
                {new Date(m.scheduledAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}
              </span>
            )}
            {m.status === "LIVE" && (
              <span className="flex items-center gap-1 font-semibold text-red-400">
                <Radio className="h-3 w-3 animate-pulse" /> LIVE
              </span>
            )}
          </span>
        </div>
        {[
          { n: homeN, id: m.homeTeamId, s: m.homeScore, note: m.homeScoreNote },
          { n: awayN, id: m.awayTeamId, s: m.awayScore, note: m.awayScoreNote },
        ].map((side, i) => (
          <div key={i} className="mt-1.5 flex items-center gap-2">
            <TeamBadge team={side.id ? teams.get(side.id) : null} size={compact ? 20 : 24} />
            <span className={`flex-1 truncate text-sm ${winner && side.id === winner ? "font-semibold text-emerald-300" : side.id ? "text-zinc-200" : "italic text-zinc-500"}`}>
              {side.n}
            </span>
            {side.note ? (
              <span className="text-xs text-zinc-400">{side.note}</span>
            ) : side.s != null ? (
              <span className={`text-sm font-bold ${winner && side.id === winner ? "text-emerald-400" : "text-zinc-300"}`}>{side.s}</span>
            ) : null}
          </div>
        ))}
        {m.status === "COMPLETED" && m.playerOfMatch && (
          <div className="mt-1.5 text-[11px] text-amber-400">🏅 {m.playerOfMatch.name}</div>
        )}
      </div>
    );
    // Every decided match opens its own match centre (scorecard +
    // commentary + info) — the ESPN model, where the card is the doorway.
    return m.homeTeamId && m.awayTeamId ? (
      <Link key={m.id} href={`/tournaments/${slug}/match/${m.id}`} className="block transition hover:scale-[1.01]">
        {inner}
      </Link>
    ) : (
      <div key={m.id}>{inner}</div>
    );
  };

  /** The pinned live card — what a follower wants before anything else. */
  const liveHero = (m: MatchLite) => {
    const homeT = m.homeTeamId ? teams.get(m.homeTeamId) : null;
    const awayT = m.awayTeamId ? teams.get(m.awayTeamId) : null;
    // Cricket reads as "30/1 (2.0)", not a bare number.
    const cricket = (m.liveState || null) as
      | { sport?: string; innings?: { teamId: string; runs: number; wickets: number; balls: number }[]; target?: number | null }
      | null;
    const lineFor = (teamId: string | null, fallback: number | null) => {
      const inn = cricket?.sport === "CRICKET" && teamId
        ? cricket.innings?.find((x) => x.teamId === teamId)
        : null;
      if (inn) return `${inn.runs}/${inn.wickets}`;
      return String(fallback ?? 0);
    };
    const oversFor = (teamId: string | null) => {
      const inn = cricket?.sport === "CRICKET" && teamId
        ? cricket.innings?.find((x) => x.teamId === teamId)
        : null;
      return inn ? `${Math.floor(inn.balls / 6)}.${inn.balls % 6} ov` : null;
    };
    return (
      <Link
        key={m.id}
        href={`/tournaments/${slug}/match/${m.id}`}
        className="block overflow-hidden rounded-2xl border border-red-500/40 bg-gradient-to-br from-red-950/40 via-zinc-900 to-zinc-950 transition hover:border-red-500/60"
      >
        <div className="flex items-center justify-between border-b border-red-500/20 px-4 py-2 text-[11px]">
          <span className="flex items-center gap-1.5 font-semibold text-red-400">
            <Radio className="h-3 w-3 animate-pulse" /> LIVE NOW
          </span>
          <span className="text-zinc-400">{m.roundLabel}</span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-4">
          <div className="flex items-center gap-2.5">
            <TeamBadge team={homeT} size={34} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-white">{homeT?.name || "TBD"}</div>
              <div className="text-2xl font-bold text-emerald-400">
                {m.homeScoreNote || lineFor(m.homeTeamId, m.homeScore)}
                {oversFor(m.homeTeamId) && (
                  <span className="ml-1.5 text-xs font-normal text-zinc-500">
                    ({oversFor(m.homeTeamId)})
                  </span>
                )}
              </div>
            </div>
          </div>
          <span className="text-xs text-zinc-600">vs</span>
          <div className="flex items-center justify-end gap-2.5 text-right">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-white">{awayT?.name || "TBD"}</div>
              <div className="text-2xl font-bold text-emerald-400">
                {m.awayScoreNote || lineFor(m.awayTeamId, m.awayScore)}
                {oversFor(m.awayTeamId) && (
                  <span className="ml-1.5 text-xs font-normal text-zinc-500">
                    ({oversFor(m.awayTeamId)})
                  </span>
                )}
              </div>
            </div>
            <TeamBadge team={awayT} size={34} />
          </div>
        </div>
        <div className="border-t border-red-500/20 px-4 py-2 text-center text-xs text-zinc-400">
          {cricket?.target ? (
            <span className="text-amber-400">Target {cricket.target} · </span>
          ) : null}
          Tap for the live scorecard &amp; ball-by-ball →
        </div>
      </Link>
    );
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      {/* Header */}
      <div className="mb-1 flex items-center gap-2 text-sm text-zinc-500">
        <Link href={`/tournaments/${slug}`} className="hover:text-zinc-300">← {t.name}</Link>
      </div>

      {/* LIVE card(s), pinned above everything */}
      {liveMatches.length > 0 && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mb-5 space-y-3">
          {liveMatches.map((m) => liveHero(m))}
          {showLiveLinks && (
            <div className="flex justify-center">
              <Link
                href={`/tournaments/${slug}/live/${liveMatches[0]!.id}`}
                className="text-xs text-red-400 underline-offset-2 hover:underline"
              >
                Open the big-screen view →
              </Link>
            </div>
          )}
        </motion.div>
      )}

      {/* Tabs */}
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-zinc-800">
        {TABS.filter((x) => (t.format === "LEAGUE" ? x.key !== "reveal" && x.key !== "bracket" : t.format === "KNOCKOUT" ? x.key !== "reveal" && x.key !== "table" : true)).map(
          ({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm ${tab === key ? "border-emerald-500 text-white" : "border-transparent text-zinc-400 hover:text-zinc-200"}`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          )
        )}
      </div>

      {/* ══ POOLS / REVEAL ══ */}
      {tab === "reveal" && (
        <div>
          {!data.poolsRevealed ? (
            <div className="py-12 text-center">
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                <Sparkles className="mx-auto h-10 w-10 text-violet-400" />
                <h2 className="mt-3 text-2xl font-bold text-white">Pool Reveal</h2>
                <p className="mb-8 mt-1 text-zinc-400">
                  {t.revealAt && new Date(t.revealAt) > new Date()
                    ? "The draw goes live in…"
                    : "The draw will be revealed soon — stay on this page!"}
                </p>
              </motion.div>
              {t.revealAt && new Date(t.revealAt) > new Date() && <Countdown target={t.revealAt} />}
              <motion.div
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ repeat: Infinity, duration: 2.4 }}
                className="mt-10 text-xs uppercase tracking-widest text-zinc-600"
              >
                {data.teams.length} teams · {t.status === "REG_OPEN" ? "registrations open" : "waiting for the draw"}
              </motion.div>
            </div>
          ) : (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">The Pools</h2>
                <button onClick={playDraw} className="flex items-center gap-1.5 rounded-lg border border-violet-500/40 px-3 py-1.5 text-xs text-violet-300 hover:bg-violet-500/10">
                  <Sparkles className="h-3.5 w-3.5" /> {drawPlayed ? "Replay draw" : "Play the draw"}
                </button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {data.pools.map((pool) => {
                  const poolTeams = drawOrder.filter((d) => d.poolId === pool.id);
                  return (
                    <div key={pool.id} className="rounded-2xl border border-violet-500/20 bg-gradient-to-b from-violet-500/5 to-transparent p-4">
                      <h3 className="mb-3 text-center font-bold tracking-wide text-violet-300">{pool.name}</h3>
                      <div className="space-y-2">
                        {poolTeams.map(({ team }) => {
                          const revealIndex = drawOrder.findIndex((d) => d.team.id === team.id);
                          const visible = !drawPlayed || drawStep >= revealIndex;
                          return (
                            <AnimatePresence key={team.id}>
                              {visible && (
                                <motion.div
                                  initial={drawPlayed ? { opacity: 0, y: -30, rotateX: 90, scale: 0.8 } : { opacity: 0 }}
                                  animate={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
                                  transition={{ type: "spring", stiffness: 240, damping: 20 }}
                                  className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-2.5"
                                >
                                  <TeamBadge team={team} size={34} />
                                  <span className="font-medium text-white">{team.name}</span>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-4 text-center text-xs text-zinc-500">
                Top {t.advancePerPool} from each pool advance to the knockouts.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ══ POINTS TABLE ══ */}
      {tab === "table" && (
        <div className="space-y-6">
          {data.standings.length === 0 && (
            <p className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center text-sm text-zinc-500">
              The points table appears once the pools are revealed.
            </p>
          )}
          {data.standings.map((s) => (
            <div key={s.poolId || "league"} className="overflow-hidden rounded-2xl border border-zinc-800">
              {s.poolName && (
                <div className="border-b border-zinc-800 bg-violet-500/5 px-4 py-2.5 text-sm font-semibold text-violet-300">
                  {s.poolName}
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-[11px] uppercase tracking-wide text-zinc-500">
                      <th className="px-4 py-2.5 font-medium">#</th>
                      <th className="py-2.5 pr-4 font-medium">Team</th>
                      <th className="py-2.5 pr-3 text-center font-medium">P</th>
                      <th className="py-2.5 pr-3 text-center font-medium">W</th>
                      <th className="py-2.5 pr-3 text-center font-medium">D</th>
                      <th className="py-2.5 pr-3 text-center font-medium">L</th>
                      <th className="py-2.5 pr-3 text-center font-medium">+/−</th>
                      {isCricket && (
                        <th className="py-2.5 pr-3 text-center font-medium">NRR</th>
                      )}
                      <th className="py-2.5 pr-4 text-center font-medium">Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(s.rows as StandRow[]).map((r, i) => {
                      const qualifies = t.format === "POOLS_KNOCKOUT" && i < t.advancePerPool;
                      return (
                        <motion.tr
                          key={r.teamId}
                          layout
                          transition={{ type: "spring", stiffness: 300, damping: 30 }}
                          className={`border-b border-zinc-800/60 ${qualifies ? "bg-emerald-500/[0.06]" : "bg-zinc-950/40"}`}
                        >
                          <td className="px-4 py-2.5">
                            <span className={`${qualifies ? "text-emerald-400" : "text-zinc-500"} font-semibold`}>{i + 1}</span>
                          </td>
                          <td className="py-2.5 pr-4">
                            <span className="flex items-center gap-2.5">
                              <TeamBadge team={teams.get(r.teamId)} size={26} />
                              <span className="font-medium text-white">{teams.get(r.teamId)?.name || "—"}</span>
                            </span>
                          </td>
                          <td className="py-2.5 pr-3 text-center text-zinc-300">{r.played}</td>
                          <td className="py-2.5 pr-3 text-center text-zinc-300">{r.won}</td>
                          <td className="py-2.5 pr-3 text-center text-zinc-300">{r.drawn}</td>
                          <td className="py-2.5 pr-3 text-center text-zinc-300">{r.lost}</td>
                          <td className={`py-2.5 pr-3 text-center ${r.scoreDiff > 0 ? "text-emerald-400" : r.scoreDiff < 0 ? "text-red-400" : "text-zinc-400"}`}>
                            {r.scoreDiff > 0 ? "+" : ""}
                            {r.scoreDiff}
                          </td>
                          {isCricket && (
                            <td
                              className={`py-2.5 pr-3 text-center tabular-nums ${
                                r.nrr == null
                                  ? "text-zinc-600"
                                  : r.nrr > 0
                                    ? "text-emerald-400"
                                    : r.nrr < 0
                                      ? "text-red-400"
                                      : "text-zinc-400"
                              }`}
                              title={
                                r.nrr == null
                                  ? "No ball-by-ball data for this team's matches"
                                  : r.nrrMatches < r.played
                                    ? `From ${r.nrrMatches} of ${r.played} matches — the rest were scored by hand`
                                    : undefined
                              }
                            >
                              {formatNrr(r.nrr)}
                              {r.nrr != null && r.nrrMatches < r.played && (
                                <span className="text-zinc-600">*</span>
                              )}
                            </td>
                          )}
                          <td className="py-2.5 pr-4 text-center">
                            <span className="font-bold text-white">{r.points}</span>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {t.format === "POOLS_KNOCKOUT" && data.standings.length > 0 && (
            <p className="text-center text-xs text-zinc-500">
              <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500/40 align-middle" />
              Qualification zone — top {t.advancePerPool} advance · updates live
            </p>
          )}
        </div>
      )}

      {/* ══ BRACKET ══ */}
      {tab === "bracket" && (
        <div className="overflow-x-auto pb-4">
          {(() => {
            const stages = ["R16", "QF", "SF", "FINAL"].filter((st) => data.matches.some((m) => m.stage === st));
            const third = data.matches.filter((m) => m.stage === "THIRD_PLACE");
            if (stages.length === 0) {
              return (
                <p className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center text-sm text-zinc-500">
                  The bracket appears once fixtures are generated.
                </p>
              );
            }
            const STAGE_TITLE: Record<string, string> = { R16: "Round of 16", QF: "Quarter Finals", SF: "Semi Finals", FINAL: "Final" };
            return (
              <div className="flex min-w-max gap-6">
                {stages.map((st, si) => (
                  <motion.div
                    key={st}
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: si * 0.12 }}
                    className="flex w-64 flex-col justify-around gap-4"
                  >
                    <div className="text-center text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      {STAGE_TITLE[st]}
                    </div>
                    {data.matches
                      .filter((m) => m.stage === st)
                      .map((m) => matchCard(m, true))}
                    {st === "FINAL" && third.length > 0 && (
                      <div>
                        <div className="mb-2 text-center text-[11px] uppercase tracking-wider text-zinc-500">3rd Place</div>
                        {third.map((m) => matchCard(m, true))}
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* ══ MATCHES ══ */}
      {tab === "matches" && (
        <div className="space-y-5">
          {(() => {
            if (data.matches.length === 0) {
              return <p className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center text-sm text-zinc-500">Fixtures coming soon.</p>;
            }
            // ESPN's ordering: what's on now, then what's next, then results.
            // Within upcoming/results, group by match day.
            const live = data.matches.filter((m) => m.status === "LIVE");
            const done = data.matches.filter((m) => ["COMPLETED", "WALKOVER"].includes(m.status));
            const upcoming = data.matches.filter(
              (m) => !live.includes(m) && !done.includes(m)
            );
            const byDay = (ms: MatchLite[]) => {
              const map = new Map<string, MatchLite[]>();
              for (const m of ms) {
                const key = m.scheduledAt
                  ? new Date(m.scheduledAt).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" })
                  : "Date to be confirmed";
                map.set(key, [...(map.get(key) || []), m]);
              }
              return [...map.entries()];
            };
            const section = (title: string, ms: MatchLite[], accent?: string) =>
              ms.length === 0 ? null : (
                <div key={title}>
                  <h3 className={`mb-2 text-sm font-semibold ${accent || "text-zinc-300"}`}>{title}</h3>
                  <div className="grid gap-2 sm:grid-cols-2">{ms.map((m) => matchCard(m))}</div>
                </div>
              );
            return (
              <>
                {section("● Live now", live, "text-red-400")}
                {byDay(upcoming).map(([day, ms]) => section(day, ms))}
                {section("Results", done, "text-zinc-400")}
              </>
            );
          })()}
        </div>
      )}

      {/* ══ LEADERS ══ */}
      {tab === "leaders" && (
        <div className="grid gap-5 md:grid-cols-2">
          {data.leaderboards.length === 0 && (
            <p className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center text-sm text-zinc-500 md:col-span-2">
              Player leaderboards appear once matches are scored.
            </p>
          )}
          {data.leaderboards.map((lb) => {
            const max = Math.max(1, ...lb.rows.map((r) => r!.value));
            return (
              <div key={lb.key} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
                <h3 className="mb-4 flex items-center gap-2 font-semibold text-white">
                  <Trophy className="h-4 w-4 text-amber-400" /> Most {lb.label}
                </h3>
                {lb.rows.length === 0 ? (
                  <p className="text-sm text-zinc-500">No entries yet.</p>
                ) : (
                  <div className="space-y-2.5">
                    {lb.rows.map((r, i) => (
                      <div key={r!.memberId} className="flex items-center gap-3">
                        <span className={`w-5 text-right text-sm font-bold ${i === 0 ? "text-amber-400" : "text-zinc-500"}`}>{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-sm font-medium text-white">{r!.name}</span>
                            <span className="text-sm font-bold text-emerald-400">{r!.value}</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${(r!.value / max) * 100}%` }}
                              transition={{ duration: 0.7, delay: i * 0.05 }}
                              className="h-full rounded-full"
                              style={{ backgroundColor: r!.teamColor || "#10b981" }}
                            />
                          </div>
                          <div className="mt-0.5 text-[11px] text-zinc-500">{r!.teamName}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
