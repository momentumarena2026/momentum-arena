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
}

export interface AdminTournamentDetail {
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
}

/** Courts a fixture can be scheduled on. Sent with the detail payload so
 *  the screen has them the moment it renders. */
export interface AdminCourt {
  id: string;
  label: string;
}

export const adminTournamentsApi = {
  list: () =>
    request<{ tournaments: AdminTournamentCard[] }>("/api/mobile/admin/tournaments", { method: "GET" }),
  detail: (id: string) =>
    request<{ tournament: AdminTournamentDetail; courts: AdminCourt[] }>(
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
