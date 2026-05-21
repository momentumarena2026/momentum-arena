import { request } from "./admin-api";

export interface AdminRewardsOverview {
  totalUsersWithBalance: number;
  totalPointsOutstanding: number;
  totalPaiseOutstanding: number;
  pointsEarnedLast30d: number;
  pointsRedeemedLast30d: number;
  pointsExpiredLast30d: number;
  openAlerts: number;
  enabled: boolean;
  earnRateBookingBps: number;
  earnRateCafeBps: number;
}

export interface AdminAlertRow {
  id: string;
  kind: string;
  severity: string;
  status: string;
  details: unknown;
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    phone: string | null;
  };
}

export interface AdminUserSearchRow {
  userId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  pointsAvailable: number;
}

/** Same enum order as the web ledger panel so the type-pill filter
 *  reads identically on both surfaces. */
export const REWARD_TXN_TYPES = [
  "EARNED_BOOKING",
  "EARNED_BOOKING_REMAINDER",
  "EARNED_CAFE",
  "EARNED_SIGNUP",
  "EARNED_REFERRAL",
  "EARNED_BIRTHDAY",
  "EARNED_ADJUSTMENT",
  "ADJUSTMENT_REFUND",
  "REDEEMED_BOOKING",
  "REDEEMED_CAFE",
  "REVOKED",
  "EXPIRED",
  "ADJUSTMENT_DEBIT",
] as const;

export type RewardTxnType = (typeof REWARD_TXN_TYPES)[number];

export interface AdminRewardTxnRow {
  id: string;
  type: RewardTxnType;
  points: number;
  pointsValuePaise: number;
  bookingId: string | null;
  cafeOrderId: string | null;
  reason: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  actor: { username: string; email: string } | null;
}

export interface AdminRewardTxnAggregates {
  creditPoints: number;
  debitPoints: number;
  netPoints: number;
  creditCount: number;
  debitCount: number;
  creditValuePaise: number;
  debitValuePaise: number;
}

export interface AdminRewardTxnLedger {
  rows: AdminRewardTxnRow[];
  total: number;
  page: number;
  pageSize: number;
  aggregates: AdminRewardTxnAggregates;
  aggregateTruncated: boolean;
}

export interface AdminRewardTxnFilters {
  query?: string;
  fromDate?: string; // yyyy-mm-dd (IST midnight)
  toDate?: string;
  types?: readonly RewardTxnType[];
  direction?: "credit" | "debit" | "all";
  sourceId?: string;
  actorQuery?: string;
  page?: number;
  pageSize?: number;
}

export const adminRewardsApi = {
  overview: () =>
    request<{ overview: AdminRewardsOverview }>(
      "/api/mobile/admin/rewards/overview",
      { method: "GET" },
    ),

  alerts: (status?: "OPEN" | "DISMISSED" | "ACTIONED") =>
    request<{ alerts: AdminAlertRow[] }>(
      `/api/mobile/admin/rewards/alerts${status ? `?status=${status}` : ""}`,
      { method: "GET" },
    ),

  updateAlert: (input: {
    id: string;
    status: "DISMISSED" | "ACTIONED";
    resolution?: string;
  }) =>
    request<{ ok: true }>("/api/mobile/admin/rewards/alerts", {
      method: "POST",
      body: input,
    }),

  searchUsers: (query: string, limit = 50) =>
    request<{ users: AdminUserSearchRow[] }>(
      `/api/mobile/admin/rewards/users/search?query=${encodeURIComponent(
        query,
      )}&limit=${limit}`,
      { method: "GET" },
    ),

  /** Resolve every user ID matching the search query (no pagination
   *  cap, but bounded at 10k IDs server-side). Drives "Select all
   *  matching" on the mobile distribute screen. */
  allMatchingUserIds: (query: string) =>
    request<{ userIds: string[]; total: number; truncated: boolean }>(
      `/api/mobile/admin/rewards/users/all-matching?query=${encodeURIComponent(
        query,
      )}`,
      { method: "GET" },
    ),

  grant: (input: { userIds: string[]; points: number; reason: string }) =>
    request<{
      granted: number;
      skipped: number;
      totalPointsAwarded: number;
    }>("/api/mobile/admin/rewards/grant", { method: "POST", body: input }),

  /** Cross-user reward transactions ledger. Filters match the web
   *  /admin/rewards Transactions tab — same params, same response
   *  shape. UI consumers should debounce free-text fields before
   *  passing them in. */
  transactions: (filters: AdminRewardTxnFilters = {}) => {
    const sp = new URLSearchParams();
    if (filters.query) sp.set("q", filters.query);
    if (filters.fromDate) sp.set("from", filters.fromDate);
    if (filters.toDate) sp.set("to", filters.toDate);
    if (filters.types && filters.types.length > 0)
      sp.set("types", filters.types.join(","));
    if (filters.direction && filters.direction !== "all")
      sp.set("dir", filters.direction);
    if (filters.sourceId) sp.set("src", filters.sourceId);
    if (filters.actorQuery) sp.set("actor", filters.actorQuery);
    if (filters.page) sp.set("page", String(filters.page));
    if (filters.pageSize) sp.set("pageSize", String(filters.pageSize));
    const qs = sp.toString();
    return request<AdminRewardTxnLedger>(
      `/api/mobile/admin/rewards/transactions${qs ? `?${qs}` : ""}`,
      { method: "GET" },
    );
  },
};
