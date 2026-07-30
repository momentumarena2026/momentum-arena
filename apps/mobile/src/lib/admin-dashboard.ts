import { request } from "./admin-api";

export interface AdminDashboardStats {
  /** null when the signed-in admin isn't a superadmin — the server keeps
   *  business aggregates (lifetime bookings, earnings) owner-only. */
  totalBookings: number | null;
  todayBookings: number;
  totalUsers: number;
  todayEarning: number | null;
  totalEarning: number | null;
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
