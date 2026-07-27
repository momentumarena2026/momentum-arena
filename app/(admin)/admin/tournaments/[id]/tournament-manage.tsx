"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Users,
  Settings,
  LayoutDashboard,
  ChevronRight,
  IndianRupee,
  Radio,
  Grid3x3,
  CalendarClock,
} from "lucide-react";
import {
  transitionTournament,
  setTeamStatus,
  recordTeamPayment,
  type TournamentWizardInput,
} from "@/actions/admin-tournaments";
import { STATUS_FLOW, STATUS_LABELS, onlinePayable } from "@/lib/tournament-config";
import { TournamentWizard } from "../tournament-wizard";
import { PoolsTab } from "./pools-tab";
import { FixturesTab, type MatchRow } from "./fixtures-tab";

// Serialized shapes from getTournamentAdmin (dates as ISO strings).
type MemberRow = { id: string; name: string; isCaptain: boolean; order: number };
type TeamRow = {
  id: string;
  name: string;
  status: string;
  color: string | null;
  logoUrl: string | null;
  poolId: string | null;
  captainName: string;
  captainPhone: string;
  paidAmount: number;
  dueAmount: number;
  paymentMethod: string | null;
  couponCode: string | null;
  pool: { name: string } | null;
  members: MemberRow[];
  createdAt: string;
};
export type AdminTournament = {
  id: string;
  slug: string;
  name: string;
  sport: "CRICKET" | "FOOTBALL" | "PICKLEBALL";
  status: string;
  format: "LEAGUE" | "KNOCKOUT" | "POOLS_KNOCKOUT";
  description: string | null;
  rules: string | null;
  bannerImageUrl: string | null;
  totalTeams: number;
  poolCount: number;
  teamsPerPool: number;
  advancePerPool: number;
  thirdPlaceMatch: boolean;
  membersPerTeamMin: number;
  membersPerTeamMax: number;
  entryFee: number;
  feeMode: "FULL" | "ADVANCE" | "FREE";
  advancePct: number;
  allowCoupons: boolean;
  allowRewardPoints: boolean;
  waitlistEnabled: boolean;
  regOpenAt: string | null;
  regCloseAt: string | null;
  revealAt: string | null;
  startDate: string | null;
  endDate: string | null;
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  tiebreakers: string[];
  statFields: { key: string; label: string }[] | null;
  prizePool: number | null;
  prizes: { place: string; label: string }[] | null;
  liveScoringEnabled: boolean;
  liveScreenPlatform: "BOTH" | "APP_ONLY" | "WEB_ONLY" | "OFF";
  scorerCode: string | null;
  teams: TeamRow[];
  pools: { id: string; name: string; order: number; teams: { id: string; name: string }[] }[];
  matches: MatchRow[];
  _count: { matches: number };
};

const TEAM_STATUS_STYLE: Record<string, string> = {
  CONFIRMED: "text-emerald-400",
  PENDING_PAYMENT: "text-amber-400",
  WAITLISTED: "text-sky-400",
  WITHDRAWN: "text-zinc-500",
  REJECTED: "text-red-400",
};

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TournamentManage({
  tournament: t,
  courts,
}: {
  tournament: AdminTournament;
  courts: { id: string; label: string; size: string }[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"overview" | "teams" | "pools" | "fixtures" | "settings">(
    "overview"
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collectFor, setCollectFor] = useState<string | null>(null);
  const [collectAmt, setCollectAmt] = useState("");

  const confirmed = t.teams.filter((x) => x.status === "CONFIRMED").length;
  const payable = onlinePayable(t.entryFee, t.feeMode, t.advancePct);

  const doTransition = async (to: string) => {
    setBusy(`tr-${to}`);
    setError(null);
    try {
      const res = await transitionTournament(t.id, to);
      if (!res.success) setError(res.error || "Failed");
      else router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const doTeamStatus = async (teamId: string, status: "CONFIRMED" | "WAITLISTED" | "WITHDRAWN" | "REJECTED") => {
    setBusy(`team-${teamId}`);
    setError(null);
    try {
      const res = await setTeamStatus(teamId, status);
      if (!res.success) setError(res.error || "Failed");
      else router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const doCollect = async (teamId: string) => {
    const amt = parseInt(collectAmt.replace(/[^\d]/g, ""), 10);
    if (!amt) return;
    setBusy(`pay-${teamId}`);
    setError(null);
    try {
      const res = await recordTeamPayment(teamId, amt, "CASH");
      if (!res.success) setError(res.error || "Failed");
      else {
        setCollectFor(null);
        setCollectAmt("");
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  };

  const wizardInitial: TournamentWizardInput & { id: string } = {
    id: t.id,
    name: t.name,
    sport: t.sport,
    format: t.format,
    description: t.description || "",
    rules: t.rules || "",
    bannerImageUrl: t.bannerImageUrl || "",
    totalTeams: t.totalTeams,
    poolCount: t.poolCount,
    teamsPerPool: t.teamsPerPool,
    advancePerPool: t.advancePerPool,
    thirdPlaceMatch: t.thirdPlaceMatch,
    membersPerTeamMin: t.membersPerTeamMin,
    membersPerTeamMax: t.membersPerTeamMax,
    entryFee: t.entryFee,
    feeMode: t.feeMode,
    advancePct: t.advancePct,
    allowCoupons: t.allowCoupons,
    allowRewardPoints: t.allowRewardPoints,
    waitlistEnabled: t.waitlistEnabled,
    regOpenAt: toLocalInput(t.regOpenAt),
    regCloseAt: toLocalInput(t.regCloseAt),
    revealAt: toLocalInput(t.revealAt),
    startDate: toLocalInput(t.startDate),
    endDate: toLocalInput(t.endDate),
    pointsWin: t.pointsWin,
    pointsDraw: t.pointsDraw,
    pointsLoss: t.pointsLoss,
    tiebreakers: t.tiebreakers as TournamentWizardInput["tiebreakers"],
    statFields: t.statFields || [],
    prizePool: t.prizePool,
    prizes: t.prizes || [],
    liveScoringEnabled: t.liveScoringEnabled,
    liveScreenPlatform: t.liveScreenPlatform,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <span>Tournaments</span>
          <ChevronRight className="h-3 w-3" />
          <span className="text-zinc-300">{t.name}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-white">{t.name}</h1>
          <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300">
            {STATUS_LABELS[t.status] || t.status}
          </span>
          {t.liveScoringEnabled && (
            <span className="flex items-center gap-1 rounded-full border border-red-500/40 px-2.5 py-1 text-xs text-red-400">
              <Radio className="h-3 w-3" /> Live scoring · {t.liveScreenPlatform.replace("_", " ")}
              {t.scorerCode && <span className="ml-1 font-mono text-zinc-400">code {t.scorerCode}</span>}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          {t.sport} · {t.format === "POOLS_KNOCKOUT" ? "Pools → Knockout" : t.format} · {confirmed}/{t.totalTeams} teams confirmed · Public URL: /tournaments/{t.slug}
        </p>
      </div>

      {/* Lifecycle actions */}
      {(STATUS_FLOW[t.status] || []).length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">Move to:</span>
          {(STATUS_FLOW[t.status] || []).map((to) => (
            <button
              key={to}
              onClick={() => doTransition(to)}
              disabled={busy === `tr-${to}`}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                to === "CANCELLED"
                  ? "border-red-500/30 text-red-400 hover:bg-red-600/10"
                  : "border-emerald-500/30 text-emerald-400 hover:bg-emerald-600/10"
              } disabled:opacity-50`}
            >
              {busy === `tr-${to}` && <Loader2 className="h-3 w-3 animate-spin" />}
              {STATUS_LABELS[to] || to}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-800">
        {(
          [
            ["overview", "Overview", LayoutDashboard],
            ["teams", `Teams (${t.teams.length})`, Users],
            ...(t.format === "POOLS_KNOCKOUT"
              ? ([["pools", "Pools & Draw", Grid3x3]] as const)
              : []),
            ["fixtures", `Fixtures (${t.matches.length})`, CalendarClock],
            ["settings", "Settings", Settings],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm ${
              tab === key
                ? "border-emerald-500 text-white"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === "overview" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Teams confirmed", `${confirmed} / ${t.totalTeams}`],
            ["Entry fee", t.feeMode === "FREE" ? "Free" : `₹${t.entryFee.toLocaleString("en-IN")} (${t.feeMode === "ADVANCE" ? `₹${payable} online` : "full online"})`],
            ["Prize pool", t.prizePool ? `₹${t.prizePool.toLocaleString("en-IN")}` : "—"],
            ["Matches", String(t._count.matches)],
            ["Collected online + venue", `₹${t.teams.reduce((s, x) => s + x.paidAmount, 0).toLocaleString("en-IN")}`],
            ["Due at venue", `₹${t.teams.reduce((s, x) => s + x.dueAmount, 0).toLocaleString("en-IN")}`],
            ["Pools", t.format === "POOLS_KNOCKOUT" ? `${t.poolCount} × ${t.teamsPerPool} (top ${t.advancePerPool} advance)` : "—"],
            ["Squad size", `${t.membersPerTeamMin}–${t.membersPerTeamMax} players`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="text-xs text-zinc-500">{label}</div>
              <div className="mt-1 text-lg font-semibold text-white">{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Teams ── */}
      {tab === "teams" && (
        <div className="space-y-3">
          {t.teams.length === 0 && (
            <p className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-500">
              No registrations yet. Teams appear here as captains register.
            </p>
          )}
          {t.teams.map((team) => (
            <div key={team.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white"
                    style={{ backgroundColor: team.color || "#3f3f46" }}
                  >
                    {team.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={team.logoUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
                    ) : (
                      team.name.slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">{team.name}</span>
                      <span className={`text-xs ${TEAM_STATUS_STYLE[team.status] || "text-zinc-400"}`}>
                        {team.status.replace("_", " ")}
                      </span>
                      {team.pool && <span className="text-xs text-violet-400">{team.pool.name}</span>}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {team.captainName} · {team.captainPhone} · {team.members.length} players
                      {team.couponCode && <> · coupon {team.couponCode}</>}
                    </div>
                    <div className="text-xs text-zinc-500">
                      Paid ₹{team.paidAmount.toLocaleString("en-IN")}
                      {team.dueAmount > 0 && <span className="text-amber-400"> · Due ₹{team.dueAmount.toLocaleString("en-IN")}</span>}
                      {team.paymentMethod && <> · {team.paymentMethod}</>}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {team.status !== "CONFIRMED" && (
                    <button onClick={() => doTeamStatus(team.id, "CONFIRMED")} disabled={busy === `team-${team.id}`} className="rounded-lg border border-emerald-500/30 px-2.5 py-1.5 text-xs text-emerald-400 hover:bg-emerald-600/10 disabled:opacity-50">Confirm</button>
                  )}
                  {team.status !== "WAITLISTED" && team.status !== "CONFIRMED" && (
                    <button onClick={() => doTeamStatus(team.id, "WAITLISTED")} disabled={busy === `team-${team.id}`} className="rounded-lg border border-sky-500/30 px-2.5 py-1.5 text-xs text-sky-400 hover:bg-sky-600/10 disabled:opacity-50">Waitlist</button>
                  )}
                  {team.dueAmount > 0 && (
                    <button onClick={() => { setCollectFor(collectFor === team.id ? null : team.id); setCollectAmt(String(team.dueAmount)); }} className="flex items-center gap-1 rounded-lg border border-amber-500/30 px-2.5 py-1.5 text-xs text-amber-400 hover:bg-amber-600/10">
                      <IndianRupee className="h-3 w-3" /> Collect
                    </button>
                  )}
                  {team.status !== "WITHDRAWN" && team.status !== "REJECTED" && (
                    <button onClick={() => doTeamStatus(team.id, "REJECTED")} disabled={busy === `team-${team.id}`} className="rounded-lg border border-red-500/30 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-600/10 disabled:opacity-50">Reject</button>
                  )}
                </div>
              </div>
              {collectFor === team.id && (
                <div className="mt-3 flex items-center gap-2 border-t border-zinc-800 pt-3">
                  <input
                    className="w-32 rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-sm text-white"
                    inputMode="numeric"
                    value={collectAmt}
                    onChange={(e) => setCollectAmt(e.target.value)}
                  />
                  <button onClick={() => doCollect(team.id)} disabled={busy === `pay-${team.id}`} className="rounded-lg border border-emerald-500/30 px-3 py-2 text-xs text-emerald-400 hover:bg-emerald-600/10 disabled:opacity-50">
                    {busy === `pay-${team.id}` ? "Saving…" : "Record cash collection"}
                  </button>
                </div>
              )}
              {team.members.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-zinc-800 pt-3">
                  {team.members.map((m) => (
                    <span key={m.id} className="rounded-full bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300">
                      {m.name}
                      {m.isCaptain && <span className="ml-1 text-emerald-400">©</span>}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Pools & Draw ── */}
      {tab === "pools" && (
        <PoolsTab
          tournamentId={t.id}
          status={t.status}
          revealAt={t.revealAt}
          pools={t.pools}
          teams={t.teams.map((x) => ({
            id: x.id,
            name: x.name,
            status: x.status,
            poolId: x.poolId,
            color: x.color,
          }))}
        />
      )}

      {/* ── Fixtures ── */}
      {tab === "fixtures" && (
        <FixturesTab tournamentId={t.id} matches={t.matches} courts={courts} />
      )}

      {/* ── Settings ── */}
      {tab === "settings" && <TournamentWizard initial={wizardInitial} />}
    </div>
  );
}
