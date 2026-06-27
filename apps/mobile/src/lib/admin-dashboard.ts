import { request } from "./admin-api";

export interface AdminDashboardStats {
  totalBookings: number;
  todayBookings: number;
  totalUsers: number;
  todayEarning: number;
  totalEarning: number;
  pendingPayments: number;
  venueDueTotal: number;
}

export const adminDashboardApi = {
  /** KPI cards for the admin Home screen. */
  stats: () =>
    request<{ stats: AdminDashboardStats }>("/api/mobile/admin/stats", {
      method: "GET",
    }),
};
