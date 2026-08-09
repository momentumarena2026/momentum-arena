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
  /** Cricket net run rate; null when no match this team played was scored
   *  ball-by-ball. nrrMatches < played means the rest were typed in. */
  nrr: number | null;
  nrrMatches: number;
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
  /** Knockout wiring — the bracket follows these back from the final. */
  homeSourceMatchId?: string | null;
  awaySourceMatchId?: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homeScoreNote: string | null;
  awayScoreNote: string | null;
  winnerTeamId: string | null;
  isDraw: boolean;
  scheduledAt: string | null;
  /** Sport-specific fold — powers the "30/1 (2.0)" line on the live card. */
  liveState: unknown;
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
    poolCount: number;
    teamsPerPool: number;
    advancePerPool: number;
    bracketSeeding: "POOL_ORDER" | "OVERALL_RANK";
    revealAt: string | null;
    regOpenAt: string | null;
    regCloseAt: string | null;
    startDate: string | null;
    prizePool: number | null;
    entryFee: number;
    feeMode: "FULL" | "ADVANCE" | "FREE";
    advancePct: number;
    allowRewardPoints: boolean;
    allowCoupons: boolean;
    liveScoringEnabled: boolean;
    liveScreenPlatform: string;
    description: string | null;
    rules: string | null;
    prizes: { place: string; label: string }[] | null;
    bannerImageUrl: string | null;
    endDate: string | null;
    membersPerTeamMax: number;
    thirdPlaceMatch: boolean;
    /// VENUE or THIRD_PARTY. THIRD_PARTY hides registration and
    /// names the organiser instead — see TournamentDetailScreen.
    host: "VENUE" | "THIRD_PARTY";
    organizerName: string | null;
  };
  poolsRevealed: boolean;
  /** Admin-decided pool/league windows. SF and final are not in here. */
  matchSlots?: {
    id: string;
    date: string;
    startHour: number;
    endHour: number;
    label: string | null;
    courtLabel: string | null;
  }[];
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

export type TournamentHub = { enabled: boolean; dqrAvailable?: boolean; tournaments: TournamentListItem[] };

/** Hub list + the module master-switch. The quick-action arc reads
 *  `enabled` from the same cached query the list screen uses. */
export async function fetchTournamentHub(): Promise<TournamentHub> {
  return api.get<TournamentHub>("/api/mobile/tournaments", { auth: false });
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
  pointsToRedeem?: number | null;
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

// ── My team + squad (post-registration) ─────────────────────────────
export type MySquadMember = {
  id: string;
  name: string;
  /** Optional contact number — the venue uses it when the captain isn't
   *  around. Never required, so it can't block a squad save. */
  phone: string | null;
  isCaptain: boolean;
  locked: boolean;
};
export type MyTeam = {
  /** Captain's slot picks and the windows to pick from. */
  preferredSlotIds?: string[];
  slotsLocked?: boolean;
  matchSlots?: {
    id: string; date: string; startHour: number; endHour: number; label: string | null;
  }[];
  id: string;
  name: string;
  status: string;
  color: string | null;
  logoUrl: string | null;
  dueAmount: number;
  maxMembers: number;
  canEditSquad: boolean;
  members: MySquadMember[];
};

/** The signed-in captain's team in a tournament (null when not registered
 *  or signed out). Bearer-authed — same unified route the web uses. */
export async function getMyTeam(slug: string): Promise<MyTeam | null> {
  const res = await api.get<{ team: MyTeam | null }>(
    `/api/tournaments/my-team?slug=${encodeURIComponent(slug)}`
  );
  return res.team;
}

/** Replace the squad with the full desired player list (server reconciles
 *  stat-safely — players with recorded stats can't be dropped). */
export async function updateSquad(
  teamId: string,
  members: { name: string; phone?: string }[] | string[]
): Promise<{ success?: boolean; error?: string }> {
  return api.post("/api/tournaments/squad", { teamId, members });
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
  // The APP_ONLY gate is decided from the request's bearer token, so this
  // call must be authenticated to be recognised as the app.
  return api.get<LivePayload>(`/api/tournaments/live/${matchId}`);
}

// ── ESPN-style match centre ─────────────────────────────────────────
export type BattingRow = {
  memberId: string; name: string; runs: number; balls: number;
  fours: number; sixes: number; strikeRate: number; out: boolean; dismissal: string | null;
};
export type BowlingRow = {
  memberId: string; name: string; overs: string; runs: number; wickets: number; economy: number;
};
export type InningsCard = {
  teamId: string; teamName: string; teamColor: string | null;
  runs: number; wickets: number; overs: string; runRate: number; extras: number;
  batting: BattingRow[]; bowling: BowlingRow[];
  fallOfWickets: { wicket: number; runs: number; over: string; batter: string | null }[];
};
export type CommentaryBall = {
  seq: number; over: string; text: string; runs: number; wicket: boolean; boundary: 0 | 4 | 6;
};
/** "Who's out there right now", names already resolved. Null unless LIVE. */
export type LiveNow = {
  sport: string;
  cricket?: {
    battingTeamName: string | null;
    striker: { name: string; runs: number; balls: number } | null;
    nonStriker: { name: string; runs: number; balls: number } | null;
    bowler: { name: string; overs: string; runs: number; wickets: number } | null;
    thisOver: string[];
    partnership: { runs: number; balls: number };
  };
  football?: {
    lastGoal: { teamName: string | null; scorer: string | null; assist: string | null } | null;
    scorers: { teamName: string | null; name: string | null }[];
  };
  pickleball?: { servingTeamName: string | null; gameNumber: number };
};

export type MatchCentre = {
  match: {
    id: string; status: string; stage: string; roundLabel: string | null;
    scheduledAt: string | null; venue: string | null; sport: string;
    homeTeam: TeamLite | null; awayTeam: TeamLite | null;
    homeScore: number | null; awayScore: number | null;
    homeScoreNote: string | null; awayScoreNote: string | null;
    isDraw: boolean; winnerTeamId: string | null;
    playerOfMatch: string | null; resultText: string;
    clockSeconds: number | null; clockRunning: boolean;
  };
  tournament: { slug: string; name: string; sport: string };
  liveNow: LiveNow | null;
  innings: InningsCard[];
  commentary: CommentaryBall[];
  statTable: { teamId: string; teamName: string; rows: { name: string; values: Record<string, number> }[] }[];
  statFields: { key: string; label: string }[];
};

/** Full scorecard + commentary for one match (public). */
export async function getMatchCentre(matchId: string): Promise<MatchCentre> {
  return api.get<MatchCentre>(`/api/tournaments/match/${matchId}`, { auth: false });
}

// ── Scorer console ──────────────────────────────────────────────────
// The per-tournament scorer code IS the credential — deliberately NOT
// bearer-authed, so an on-field volunteer can score without an admin
// account (or any account at all).

export type ScorerMember = { id: string; name: string };
export type ScorerTeam = { id: string; name: string; color: string | null; members: ScorerMember[] };
export type ScorerMatch = {
  id: string;
  status: string;
  stage: string;
  roundLabel: string | null;
  scheduledAt: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homeTeam: ScorerTeam;
  awayTeam: ScorerTeam;
  liveState: unknown;
  clockStartedAt: string | null;
  clockElapsedSec: number;
};
export type ScorerBoot = {
  tournament: {
    id: string;
    name: string;
    sport: string;
    status: string;
    /** Overs one bowler may bowl in a match; 0 = no limit. */
    maxOversPerBowler?: number;
    /** Overs per side; 0 = unlimited. */
    oversPerInnings?: number;
  };
  matches: ScorerMatch[];
};

export type ScorerAction =
  | { action: "start"; matchId: string }
  | { action: "undo"; matchId: string }
  | { action: "end"; matchId: string; winnerTeamId?: string | null }
  | {
      action: "event";
      matchId: string;
      event: { kind: string; teamId?: string; memberId?: string; data?: Record<string, unknown> };
    };

/** Boot the console: the tournament behind a code + its scoreable matches.
 *  Throws ApiError 404 on a bad code, 429 when rate-limited. */
export async function fetchScorerBoot(code: string): Promise<ScorerBoot> {
  return api.get<ScorerBoot>(`/api/tournaments/scorer/${encodeURIComponent(code)}`, { auth: false });
}

export async function sendScorerAction(
  code: string,
  payload: ScorerAction
): Promise<{ success?: boolean; error?: string; needsWinner?: boolean }> {
  return api.post(`/api/tournaments/scorer/${encodeURIComponent(code)}/event`, payload, {
    auth: false,
  });
}

/**
 * Add a player to a team mid-match, from the scorer console.
 *
 * Append-only and scoped to the code's own tournament server-side — see
 * app/api/tournaments/scorer/[code]/player/route.ts for why it is that
 * narrow. Returns the existing member when the name already exists, so a
 * double tap can't split one player's stats across two rows.
 */
export async function addScorerPlayer(
  code: string,
  teamId: string,
  name: string,
): Promise<{ ok?: boolean; member?: { id: string; name: string }; error?: string }> {
  return api.post(
    `/api/tournaments/scorer/${encodeURIComponent(code)}/player`,
    { teamId, name },
    { auth: false },
  );
}

export async function fetchRewardsPreview(amount: number): Promise<{ maxPoints: number; maxPaise: number }> {
  return api.get(`/api/tournaments/rewards-preview?amount=${amount}`);
}

export type DqrInit = {
  qrImage?: string;
  qrString?: string;
  mode: string;
  transactionId: string;
  expiresIn: number;
  amount: number;
};

export async function initiateTournamentDqr(teamId: string): Promise<DqrInit> {
  return api.post<DqrInit>("/api/phonepe/dqr/tournament-initiate", { teamId });
}

export async function pollTournamentDqr(
  transactionId: string
): Promise<{ state: string; teamId?: string; error?: string }> {
  return api.get(`/api/phonepe/dqr/tournament-status?transactionId=${transactionId}`, { auth: false });
}


/** Captain saves which pre-decided windows the team can play. */
export async function saveSlotPreferences(
  teamId: string,
  slotIds: string[],
): Promise<{ success?: boolean; error?: string }> {
  return api.post("/api/tournaments/slot-preferences", { teamId, slotIds });
}
