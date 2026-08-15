import { request } from "./admin-api";

// Mobile admin client for the tournament engine. Mirrors the web manage
// screen's server actions through two thin routes (list/detail + action
// dispatch) — see app/api/mobile/admin/tournaments/*.

export interface AdminTournamentCard {
  id: string;
  name: string;
  sport: string;
  status: string;
  format: string;
  totalTeams: number;
  entryFee: number;
  liveScoringEnabled: boolean;
  /** Set when filed away; hidden from the default list. */
  archivedAt?: string | null;
  scorerCode: string | null;
  teams: number;
  matches: number;
}

export interface AdminTeamRow {
  id: string;
  name: string;
  status: string;
  captainName: string;
  captainPhone: string;
  paidAmount: number;
  dueAmount: number;
  paymentMethod: string | null;
  pool: { name: string } | null;
  /** Hour-level picks, stored as `<slotId>#<startHour>`. */
  preferredSlotIds?: string[];
  members: { id: string; name: string }[];
}

export interface AdminMatchRow {
  id: string;
  stage: string;
  status: string;
  roundLabel: string | null;
  homeTeam: { id: string; name: string } | null;
  awayTeam: { id: string; name: string } | null;
  homeSourceLabel: string | null;
  awaySourceLabel: string | null;
  homeScore: number | null;
  awayScore: number | null;
  scheduledAt: string | null;
  /** Bracket needs to know who advanced, and Scores needs to know a
   *  finished match can be reopened. */
  isDraw?: boolean;
  winnerTeamId?: string | null;
  poolId?: string | null;
}

/** One pool's ordered table. Computed on the SERVER from the same helper
 *  the web tab uses, so the phone can never rank teams differently. */
export interface AdminStandingsGroup {
  id: string | null;
  name: string | null;
  rows: {
    teamId: string;
    played: number;
    won: number;
    drawn: number;
    lost: number;
    points: number;
    scoreFor: number;
    scoreAgainst: number;
    scoreDiff: number;
    nrr: number | null;
    nrrMatches: number;
  }[];
}

export interface AdminLeaderboard {
  key: string;
  label: string;
  rows: { name: string; teamName: string | null; value: number }[];
}

/** One scheduled campaign message (push / banner) for the event. */
export interface AdminCampaignItem {
  id: string;
  milestone: string;
  kind: string;
  status: string;
  enabled: boolean;
  title: string | null;
  body: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
}

/** A draw the generator proposed; approving one schedules every fixture. */
export interface AdminSchedulePlan {
  label: string;
  scheduled: number;
  unscheduled: number;
  compromises: number;
  assignments: {
    matchId: string;
    label: string;
    date: string;
    startHour: number;
    courtLabel: string | null;
    compromised?: boolean;
  }[];
}

export interface AdminTournamentDetail {
  /** Set when filed away; the detail screen offers Unarchive instead. */
  archivedAt?: string | null;
  id: string;
  name: string;
  sport: string;
  status: string;
  format: string;
  totalTeams: number;
  /// VENUE or THIRD_PARTY. THIRD_PARTY swaps team entry fees for a hire
  /// quote the organiser pays us — see the Organiser section on the screen.
  host: "VENUE" | "THIRD_PARTY";
  organizerName: string | null;
  organizerPhone: string | null;
  organizerEmail: string | null;
  quotedAmount: number;
  organizerNote: string | null;
  entryFee: number;
  liveScoringEnabled: boolean;
  scorerCode: string | null;
  teams: AdminTeamRow[];
  matches: AdminMatchRow[];
  pools: { id: string; name: string }[];
  /** Settings tab — the wizard fields the app can edit. */
  advancePerPool: number;
  teamsPerPool: number;
  matchDurationMinutes: number;
  oversPerInnings: number | null;
  wicketsPerInnings: number | null;
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  revealAt: string | null;
  rules: string | null;
  bracketSeeding: string | null;
}

/** Courts a fixture can be scheduled on. Sent with the detail payload so
 *  the screen has them the moment it renders. */
export interface AdminCourt {
  id: string;
  label: string;
}

/** A match window from Slots & Draw. Scheduling defaults inside one of
 *  these because they are what hold the hours off the booking grid. */
export interface AdminSlotWindow {
  id: string;
  date: string;
  startHour: number;
  endHour: number;
  label: string | null;
  courtLabel: string | null;
}

export const adminTournamentsApi = {
  list: (includeArchived = false) =>
    request<{ tournaments: AdminTournamentCard[] }>(
      `/api/mobile/admin/tournaments${includeArchived ? "?archived=1" : ""}`,
      { method: "GET" },
    ),
  detail: (id: string) =>
    request<{
      tournament: AdminTournamentDetail;
      courts: AdminCourt[];
      windows: AdminSlotWindow[];
      leaderboards: AdminLeaderboard[];
      standings: AdminStandingsGroup[];
    }>(
      `/api/mobile/admin/tournaments?id=${id}`,
      { method: "GET" }
    ),
  action: (body: Record<string, unknown>) =>
    request<{ success: boolean }>("/api/mobile/admin/tournaments/action", {
      method: "POST",
      body,
    }),
  /** Organiser ledger. Goes through the same action endpoint but returns
   *  data, so it needs its own response type. */
  organizerLedger: (tournamentId: string) =>
    request<{ success: boolean; ledger: OrganizerLedger }>(
      "/api/mobile/admin/tournaments/action",
      { method: "POST", body: { op: "organizerLedger", tournamentId } },
    ),
  /** Campaign items. Loaded on demand, as on the web — most tournaments
   *  never open this tab. */
  campaignList: (tournamentId: string) =>
    request<{ success: boolean; items: AdminCampaignItem[] }>(
      "/api/mobile/admin/tournaments/action",
      { method: "POST", body: { op: "campaignList", tournamentId } },
    ),
  /** Candidate draws. Expensive to compute, so it is never part of the
   *  detail payload — the organiser asks for it. */
  scheduleCandidates: (tournamentId: string) =>
    request<{ success: boolean; plans: AdminSchedulePlan[] }>(
      "/api/mobile/admin/tournaments/action",
      { method: "POST", body: { op: "scheduleCandidates", tournamentId } },
    ),
};

export interface OrganizerLedger {
  quotedAmount: number;
  receivedAmount: number;
  outstanding: number;
  payments: {
    id: string;
    amount: number;
    method: string;
    reference: string | null;
    receivedAt: string;
    note: string | null;
  }[];
}
