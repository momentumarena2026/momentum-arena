import { Platform } from "react-native";
import { api } from "./api";

// Tournament client — consumes the SAME routes as web (unified auth):
//   GET  /api/tournaments/[slug]/public   (no auth, full payload)
//   POST /api/tournaments/register        (bearer)
//   POST /api/tournaments/verify          (bearer, Razorpay confirm)
//   GET  /api/tournaments/live/[matchId]?platform=app

export type TeamLite = {
  id: string;
  name: string;
  color: string | null;
  logoUrl: string | null;
  poolId: string | null;
};
export type Pool = { id: string; name: string; order: number };
export type StandRow = {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  scoreDiff: number;
  points: number;
};
export type MatchLite = {
  id: string;
  stage: string;
  status: string;
  roundLabel: string | null;
  poolId: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeSourceLabel: string | null;
  awaySourceLabel: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homeScoreNote: string | null;
  awayScoreNote: string | null;
  winnerTeamId: string | null;
  isDraw: boolean;
  scheduledAt: string | null;
  courtConfig: { label: string } | null;
  playerOfMatch: { name: string } | null;
};
export type LeaderBoard = {
  key: string;
  label: string;
  rows: { memberId: string; name: string; teamName: string; teamColor: string | null; value: number }[];
};
export type TournamentPublic = {
  tournament: {
    id: string;
    slug: string;
    name: string;
    sport: string;
    status: string;
    format: string;
    totalTeams: number;
    advancePerPool: number;
    revealAt: string | null;
    startDate: string | null;
    prizePool: number | null;
    liveScoringEnabled: boolean;
    liveScreenPlatform: string;
  };
  poolsRevealed: boolean;
  pools: Pool[];
  teams: TeamLite[];
  standings: { poolId: string | null; poolName: string | null; rows: StandRow[] }[];
  matches: MatchLite[];
  leaderboards: LeaderBoard[];
};

export type TournamentListItem = {
  id: string;
  slug: string;
  name: string;
  sport: string;
  status: string;
  format: string;
  bannerImageUrl: string | null;
  totalTeams: number;
  entryFee: number;
  feeMode: string;
  prizePool: number | null;
  startDate: string | null;
  liveScoringEnabled: boolean;
  confirmedTeams: number;
};

export async function listTournaments(): Promise<TournamentListItem[]> {
  // The public hub list route is web-page-only; reuse the payload per slug is
  // heavy — so this dedicated list endpoint keeps the app cheap.
  return api.get<TournamentListItem[]>("/api/mobile/tournaments", { auth: false });
}

export async function getTournament(slug: string): Promise<TournamentPublic> {
  return api.get<TournamentPublic>(`/api/tournaments/${slug}/public`, { auth: false });
}

export type RegisterPayload = {
  tournamentId: string;
  teamName: string;
  color: string | null;
  members: string[];
  captainName: string;
  captainPhone: string;
  couponCode?: string | null;
};

export type RegisterResponse = {
  ok?: boolean;
  error?: string;
  teamId?: string;
  state?: "CONFIRMED" | "WAITLISTED" | "PENDING_PAYMENT";
  order?: { orderId: string; amount: number };
  keyId?: string;
  discount?: number;
  payable?: number;
  dueAtVenue?: number;
};

export async function registerTeam(payload: RegisterPayload): Promise<RegisterResponse> {
  return api.post<RegisterResponse>("/api/tournaments/register", {
    ...payload,
    platform: Platform.OS === "ios" ? "ios" : "android",
  });
}

export async function verifyEntryPayment(args: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}): Promise<{ success?: boolean; error?: string }> {
  return api.post("/api/tournaments/verify", args);
}

export type LivePayload = {
  gated: boolean;
  reason?: string;
  match?: {
    id: string;
    status: string;
    roundLabel: string | null;
    homeTeam: TeamLite | null;
    awayTeam: TeamLite | null;
    homeScore: number | null;
    awayScore: number | null;
    homeScoreNote: string | null;
    awayScoreNote: string | null;
    winnerTeamId: string | null;
    isDraw: boolean;
    liveState: unknown;
    clockSeconds: number | null;
    clockRunning: boolean;
    playerOfMatch: string | null;
  };
  tournament?: { slug: string; name: string; sport?: string };
  events?: {
    seq: number;
    kind: string;
    teamId: string | null;
    data: Record<string, unknown> | null;
    createdAt: string;
    member: { name: string } | null;
  }[];
};

export async function getLiveMatch(matchId: string): Promise<LivePayload> {
  return api.get<LivePayload>(`/api/tournaments/live/${matchId}?platform=app`, { auth: false });
}
