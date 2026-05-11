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
};
