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
  ClipboardList,
  Megaphone,
  Table2,
  GitBranch,
  Medal,
} from "lucide-react";
import {
  transitionTournament,
  setTeamStatus,
  recordTeamPayment,
  adminRegisterTeam,
  adminEditTeam,
  rotateScorerCode,
  type TournamentWizardInput,
} from "@/actions/admin-tournaments";
import {
  STATUS_FLOW,
  STATUS_LABELS,
  onlinePayable,
  poolMatchesArePublic,
} from "@/lib/tournament-config";
import {
  TEAM_COLLECT_METHODS,
  TEAM_REGISTER_METHODS,
  TEAM_PAYMENT_METHOD_LABEL,
  type TeamCollectMethod,
} from "@/lib/tournament-payments";
import { TournamentWizard } from "../tournament-wizard";
import { PoolsTab } from "./pools-tab";
import { SlotsTab } from "./slots-tab";
import { TeamDetailModal } from "./team-detail-modal";
import { FixturesTab, type MatchRow } from "./fixtures-tab";
import { ScoresTab } from "./scores-tab";
import { CampaignTab } from "./campaign-tab";
import { BracketTab, PointsTableTab, LeadersTab } from "./standings-tabs";
import type { Leaderboard } from "@/lib/tournament-leaderboards";
import { OrganizerTab } from "./organizer-tab";
import { AddFixture } from "./add-fixture";

// Serialized shapes from getTournamentAdmin (dates as ISO strings).
type MemberRow = {
  id: string;
  name: string;
  phone: string | null;
  isCaptain: boolean;
  order: number;
};
type TeamRow = {
  id: string;
  name: string;
  status: string;
  color: string | null;
  logoUrl: string | null;
  poolId: string | null;
  captainName: string;
  captainPhone: string;
  captainEmail: string | null;
  paidAmount: number;
  dueAmount: number;
  paymentMethod: string | null;
  paymentRef: string | null;
  couponCode: string | null;
  discount: number;
  pointsUsed: number;
  /** Hour-level picks, stored as `<slotId>#<startHour>`. */
  preferredSlotIds: string[];
  pool: { name: string } | null;
  members: MemberRow[];
  archivedAt: string | null;
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
  maxOversPerBowler: number;
  oversPerInnings: number;
  bracketSeeding: "POOL_ORDER" | "OVERALL_RANK";
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
  host: "VENUE" | "THIRD_PARTY";
  organizerName: string | null;
  organizerPhone: string | null;
  organizerEmail: string | null;
  quotedAmount: number;
  organizerNote: string | null;
  scheduleApprovedAt: string | null;
  teams: TeamRow[];
  slots: {
    id: string;
    date: string;
    startHour: number;
    endHour: number;
    label: string | null;
    courtConfig: { label: string } | null;
  }[];
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
  // Render the stored instant as IST wall-clock for the datetime-local
  // input — matching toDate() in actions/admin-tournaments.ts, which pins
  // saves to +05:30. Using the browser's zone here would round-trip wrong
  // for any admin whose device isn't set to IST.
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function TournamentManage({
  tournament: t,
  courts,
  leaderboards,
}: {
  tournament: AdminTournament;
  courts: { id: string; label: string; size: string }[];
  leaderboards: Leaderboard[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<
    | "overview" | "teams" | "pools" | "slots" | "fixtures" | "scores"
    | "table" | "bracket" | "leaders"
    | "campaign" | "organizer" | "settings"
  >("overview");
  // Which match a bracket click asked the Scores tab to open.
  const [focusMatchId, setFocusMatchId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collectFor, setCollectFor] = useState<string | null>(null);
  const [collectAmt, setCollectAmt] = useState("");
  const [collectMethod, setCollectMethod] = useState<TeamCollectMethod>("CASH");
  // Per-team squad editor — squads are optional at registration, so
  // admins can build/fix any roster here at any time.
  const [squadFor, setSquadFor] = useState<string | null>(null);
  // Full team record (squad + phones + money + archive/delete) opens in a
  // dialog rather than the old comma-separated inline input, where
  // removing one player meant retyping the line and a phone had nowhere
  // to live.
  const [detailTeamId, setDetailTeamId] = useState<string | null>(null);
  const [squadText, setSquadText] = useState("");
  const [showVenueForm, setShowVenueForm] = useState(false);
  const [venueForm, setVenueForm] = useState({
    teamName: "",
    captainName: "",
    captainPhone: "",
    members: "",
    collectedAmount: "",
    method: "CASH" as "CASH" | "STATIC_QR" | "FREE",
  });

  const doVenueRegister = async () => {
    setBusy("venue");
    setError(null);
    try {
      const res = await adminRegisterTeam({
        tournamentId: t.id,
        teamName: venueForm.teamName,
        captainName: venueForm.captainName,
        captainPhone: venueForm.captainPhone,
        members: venueForm.members.split(",").map((x) => x.trim()).filter(Boolean),
        collectedAmount: parseInt(venueForm.collectedAmount.replace(/[^\d]/g, ""), 10) || 0,
        method: venueForm.method,
      });
      if (!res.success) setError(res.error || "Failed");
      else {
        setShowVenueForm(false);
        setVenueForm({ teamName: "", captainName: "", captainPhone: "", members: "", collectedAmount: "", method: "CASH" });
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  };

  const doRotateCode = async () => {
    if (!confirm("Issue a new scorer code? Anyone still using the old code loses access immediately.")) return;
    setBusy("rotate");
    setError(null);
    try {
      const res = await rotateScorerCode(t.id);
      if (!res.success) setError(res.error || "Failed");
      else router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const doSaveSquad = async (teamId: string) => {
    setBusy(`squad-${teamId}`);
    setError(null);
    try {
      const res = await adminEditTeam(teamId, {
        members: squadText.split(",").map((x) => x.trim()).filter(Boolean),
      });
      if (!res.success) setError(res.error || "Failed");
      else {
        setSquadFor(null);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  };

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
      const res = await recordTeamPayment(teamId, amt, collectMethod);
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
    host: t.host,
    organizerName: t.organizerName || "",
    organizerPhone: t.organizerPhone || "",
    organizerEmail: t.organizerEmail || "",
    quotedAmount: t.quotedAmount,
    organizerNote: t.organizerNote || "",
    maxOversPerBowler: t.maxOversPerBowler,
    oversPerInnings: t.oversPerInnings,
    bracketSeeding: t.bracketSeeding,
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
    <div className="min-w-0 space-y-6">
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
            <span className="flex max-w-full flex-wrap items-center gap-1 break-all rounded-full border border-red-500/40 px-2.5 py-1 text-xs text-red-400">
              <Radio className="h-3 w-3" /> Live scoring · {t.liveScreenPlatform.replace("_", " ")}
              {/* A link, not just text — rotating the code changes it, and a
                  bookmarked old URL is the fastest way to see "invalid code". */}
              {t.scorerCode && (
                <a
                  href={`/score/${t.scorerCode}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-1 font-mono text-zinc-300 underline decoration-dotted underline-offset-2 hover:text-white"
                  title="Open the scorer console with the current code"
                >
                  {t.scorerCode} ↗
                </a>
              )}
              <button
                onClick={doRotateCode}
                disabled={busy === "rotate"}
                title="Issue a new scorer code — anyone still holding the old one loses access"
                className="ml-1 rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                {busy === "rotate" ? "Rotating…" : "Rotate"}
              </button>
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          {t.sport} · {t.format === "POOLS_KNOCKOUT" ? "Pools → Knockout" : t.format} · {confirmed}/{t.totalTeams} teams confirmed · Public URL: /tournaments/{t.slug}
        </p>
      </div>

      {/* Scoring is happening but nobody can watch it.
          Before POOLS_REVEALED the public payload strips pool matches,
          because until the reveal the fixtures ARE the draw. Nothing
          errors — the scorer console works, the score saves, and every
          spectator sees an empty tournament page. This is the only place
          that failure is visible, so say it loudly and give the fix. */}
      {!poolMatchesArePublic(t.status) &&
        t.matches.some(
          (m) => m.stage === "POOL" && (m.status === "LIVE" || m.homeScore != null),
        ) && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
            <p className="text-sm font-semibold text-amber-300">
              Pool matches are being scored, but spectators can&apos;t see them
            </p>
            <p className="mt-1 text-xs text-amber-200/80">
              This tournament is still <strong>{STATUS_LABELS[t.status] ?? t.status}</strong>.
              Pool fixtures stay hidden from the public tournament page until the
              draw is revealed, so live scores are going nowhere.
              {(STATUS_FLOW[t.status] || []).includes("POOLS_REVEALED")
                ? " Move it to Pools Revealed (or Live) to publish them."
                : " Move it to Live to publish them."}
            </p>
          </div>
        )}

      {/* Lifecycle actions */}
      {(STATUS_FLOW[t.status] || []).length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">
            {t.status === "CANCELLED" ? "Restore to:" : "Move to:"}
          </span>
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
              {/* "Registrations Open" is a state, not an instruction. Going
                  back to it is the one transition that reads as an action,
                  so it gets an action's name. */}
              {t.status === "REG_CLOSED" && to === "REG_OPEN"
                ? "Reopen Registrations"
                : STATUS_LABELS[to] || to}
            </button>
          ))}
          {t.status === "REG_CLOSED" && t.regCloseAt && (
            <span className="w-full text-xs text-zinc-500">
              Reopening clears the closing time ({" "}
              {new Date(t.regCloseAt).toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
              })}{" "}
              ), otherwise it would close itself again straight away. Set a new
              one in Settings, or close it by hand when you have enough teams.
            </span>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Tabs */}
      {/* Seven tabs can't fit a phone. Without a scroller the row forced
          the page wider than the viewport and every section below it went
          off-screen. Scroll the strip, keep the page at viewport width. */}
      <div className="flex gap-1 overflow-x-auto border-b border-zinc-800 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {(
          [
            ["overview", "Overview", LayoutDashboard],
            ["teams", `Teams (${t.teams.length})`, Users],
            ...(t.format === "POOLS_KNOCKOUT"
              ? ([["pools", "Pools & Draw", Grid3x3]] as const)
              : []),
            ["slots", "Slots & Draw", CalendarClock],
            ["fixtures", `Fixtures (${t.matches.length})`, CalendarClock],
            ["scores", "Scores", ClipboardList],
            // A league has no bracket; a pure knockout has no points table.
            ...(t.format === "KNOCKOUT"
              ? ([] as const)
              : ([["table", "Points Table", Table2]] as const)),
            ...(t.format === "LEAGUE"
              ? ([] as const)
              : ([["bracket", "Bracket", GitBranch]] as const)),
            ["leaders", "Leaders", Medal],
            ["campaign", "Campaign", Megaphone],
            // Organiser money exists only when someone outside the venue is
            // paying us for the hire; our own events take money from teams.
            ...(t.host === "THIRD_PARTY"
              ? ([["organizer", "Organiser & Payments", IndianRupee]] as const)
              : []),
            ["settings", "Settings", Settings],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm ${
              tab === key
                ? "border-emerald-500 text-white"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {/* ── Points table ── */}
      {tab === "table" && (
        <PointsTableTab
          tournament={t}
          matches={t.matches}
          teams={t.teams}
          pools={t.pools}
        />
      )}

      {/* ── Bracket ── */}
      {tab === "bracket" && (
        <BracketTab
          matches={t.matches}
          teams={t.teams}
          // Clicking a tie is almost always a prelude to entering its
          // result, so send them straight there rather than making them
          // find the same match again in the Scores list.
          onMatchClick={(id) => {
            setFocusMatchId(id);
            setTab("scores");
          }}
        />
      )}

      {/* ── Leaders ── */}
      {tab === "leaders" && <LeadersTab leaderboards={leaderboards} />}

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
          <button
            onClick={() => setShowVenueForm((x) => !x)}
            className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-600/10 px-4 py-2.5 text-sm font-medium text-emerald-400 hover:bg-emerald-600/20"
          >
            + Register team (venue — cash / QR)
          </button>
          {showVenueForm && (
            <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <input className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white" placeholder="Team name *" value={venueForm.teamName} onChange={(e) => setVenueForm((f) => ({ ...f, teamName: e.target.value }))} />
                <input className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white" placeholder="Captain name *" value={venueForm.captainName} onChange={(e) => setVenueForm((f) => ({ ...f, captainName: e.target.value }))} />
                <input className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white" placeholder="Captain phone *" inputMode="tel" value={venueForm.captainPhone} onChange={(e) => setVenueForm((f) => ({ ...f, captainPhone: e.target.value }))} />
                <input className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white" placeholder="Players (comma-separated, optional)" value={venueForm.members} onChange={(e) => setVenueForm((f) => ({ ...f, members: e.target.value }))} />
                <input className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white" placeholder={`Collected now (fee ₹${t.entryFee})`} inputMode="numeric" value={venueForm.collectedAmount} onChange={(e) => setVenueForm((f) => ({ ...f, collectedAmount: e.target.value }))} />
                <select className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white" value={venueForm.method} onChange={(e) => setVenueForm((f) => ({ ...f, method: e.target.value as "CASH" | "STATIC_QR" | "FREE" }))}>
                  {TEAM_REGISTER_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {TEAM_PAYMENT_METHOD_LABEL[m]}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-zinc-500">
                Team is confirmed immediately; any unpaid remainder stays as &quot;Due&quot; for the Collect button.
                Squad is optional — leave players blank and add them later from the roster editor.
              </p>
              <button
                onClick={doVenueRegister}
                disabled={busy === "venue" || !venueForm.teamName.trim() || !venueForm.captainName.trim()}
                className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-600/10 px-4 py-2.5 text-sm font-medium text-emerald-400 hover:bg-emerald-600/20 disabled:opacity-40"
              >
                {busy === "venue" && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirm registration
              </button>
            </div>
          )}
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
                      {team.archivedAt && (
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
                          Archived
                        </span>
                      )}
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
                    <button onClick={() => { setCollectFor(collectFor === team.id ? null : team.id); setCollectAmt(String(team.dueAmount)); setCollectMethod("CASH"); }} className="flex items-center gap-1 rounded-lg border border-amber-500/30 px-2.5 py-1.5 text-xs text-amber-400 hover:bg-amber-600/10">
                      <IndianRupee className="h-3 w-3" /> Collect
                    </button>
                  )}
                  {team.status !== "WITHDRAWN" && team.status !== "REJECTED" && (
                    <button onClick={() => doTeamStatus(team.id, "REJECTED")} disabled={busy === `team-${team.id}`} className="rounded-lg border border-red-500/30 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-600/10 disabled:opacity-50">Reject</button>
                  )}
                </div>
              </div>
              {collectFor === team.id && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3">
                  <input
                    className="w-32 rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-sm text-white"
                    inputMode="numeric"
                    value={collectAmt}
                    onChange={(e) => setCollectAmt(e.target.value)}
                  />
                  {/* Cash isn't the only way money arrives at the counter —
                      most of it comes in on the printed UPI QR. Recording
                      it all as CASH made the payment-mode split useless. */}
                  <select
                    className="rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-sm text-white"
                    value={collectMethod}
                    onChange={(e) => setCollectMethod(e.target.value as TeamCollectMethod)}
                  >
                    {TEAM_COLLECT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {TEAM_PAYMENT_METHOD_LABEL[m]}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => doCollect(team.id)} disabled={busy === `pay-${team.id}`} className="rounded-lg border border-emerald-500/30 px-3 py-2 text-xs text-emerald-400 hover:bg-emerald-600/10 disabled:opacity-50">
                    {busy === `pay-${team.id}` ? "Saving…" : "Record collection"}
                  </button>
                </div>
              )}
              <div className="mt-3 border-t border-zinc-800 pt-3">
                {squadFor === team.id ? (
                  <div className="space-y-2">
                    <input
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
                      placeholder="Players (comma-separated)"
                      value={squadText}
                      onChange={(e) => setSquadText(e.target.value)}
                    />
                    <p className="text-xs text-zinc-500">
                      Keep a player&apos;s name to preserve their recorded stats; players with stats can&apos;t be removed.
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => doSaveSquad(team.id)} disabled={busy === `squad-${team.id}`} className="rounded-lg border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-400 hover:bg-emerald-600/10 disabled:opacity-50">
                        {busy === `squad-${team.id}` ? "Saving…" : "Save squad"}
                      </button>
                      <button onClick={() => setSquadFor(null)} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {team.members.map((m) => (
                      <span
                        key={m.id}
                        className="rounded-full bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300"
                        title={m.phone || undefined}
                      >
                        {m.name}
                        {m.isCaptain && <span className="ml-1 text-emerald-400">©</span>}
                        {m.phone && (
                          <span className="ml-1 text-zinc-500">{m.phone}</span>
                        )}
                      </span>
                    ))}
                    <button
                      onClick={() => setDetailTeamId(team.id)}
                      className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
                    >
                      ✎ Team details
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {detailTeamId
            ? (() => {
                const team = t.teams.find((x) => x.id === detailTeamId);
                if (!team) return null;
                return (
                  <TeamDetailModal
                    team={team}
                    slots={t.slots}
                    scheduleApproved={!!t.scheduleApprovedAt}
                    maxMembers={t.membersPerTeamMax}
                    onClose={() => setDetailTeamId(null)}
                    onSaved={() => router.refresh()}
                  />
                );
              })()
            : null}
        </div>
      )}

      {/* ── Pools & Draw ── */}
      {tab === "slots" && (
        <SlotsTab tournamentId={t.id} courts={courts} />
      )}

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
            preferredSlotIds: x.preferredSlotIds,
          }))}
          slots={t.slots}
          teamsPerPool={t.teamsPerPool}
        />
      )}

      {/* ── Fixtures ── */}
      {tab === "fixtures" && (
        <div className="space-y-4">
          {/* Hand-entered fixtures. Essential for a third-party event —
              the organiser hands us their schedule and generateFixtures
              can't express it (a double round-robin, an odd number of
              semi-finals). Useful on our own events for the same reason. */}
          <div className="pt-4">
            <AddFixture
              tournamentId={t.id}
              teams={t.teams
                .filter((x) => x.status === "CONFIRMED")
                .map((x) => ({ id: x.id, name: x.name }))}
              onAdded={() => router.refresh()}
            />
          </div>
          <FixturesTab tournamentId={t.id} matches={t.matches} courts={courts} />
        </div>
      )}

      {/* ── Scores ── */}
      {tab === "scores" && (
        <ScoresTab
          tournamentId={t.id}
          matches={t.matches}
          statFields={t.statFields || []}
          focusMatchId={focusMatchId}
        />
      )}

      {/* ── Campaign ── */}
      {tab === "campaign" && <CampaignTab tournamentId={t.id} />}

      {tab === "organizer" && (
        <OrganizerTab
          tournamentId={t.id}
          organizerName={t.organizerName}
          organizerPhone={t.organizerPhone}
          organizerEmail={t.organizerEmail}
          organizerNote={t.organizerNote}
        />
      )}

      {/* ── Settings ── */}
      {tab === "settings" && <TournamentWizard initial={wizardInitial} />}
    </div>
  );
}
