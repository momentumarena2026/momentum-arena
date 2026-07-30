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
  entryFee: number;
  liveScoringEnabled: boolean;
  scorerCode: string | null;
  teams: AdminTeamRow[];
  matches: AdminMatchRow[];
  pools: { id: string; name: string }[];
}

export const adminTournamentsApi = {
  list: () =>
    request<{ tournaments: AdminTournamentCard[] }>("/api/mobile/admin/tournaments", { method: "GET" }),
  detail: (id: string) =>
    request<{ tournament: AdminTournamentDetail }>(
      `/api/mobile/admin/tournaments?id=${id}`,
      { method: "GET" }
    ),
  action: (body: Record<string, unknown>) =>
    request<{ success: boolean }>("/api/mobile/admin/tournaments/action", {
      method: "POST",
      body,
    }),
};
