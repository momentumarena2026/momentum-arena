import { request } from "./admin-api";

export type AdminUserRole = "CUSTOMER" | "ADMIN" | "SUPERADMIN";

export interface AdminUser {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: AdminUserRole;
  bookingCount: number;
  /** ISO timestamp. */
  createdAt: string;
}

export interface AdminUsersPage {
  users: AdminUser[];
  total: number;
  page: number;
  totalPages: number;
}

export const adminUsersApi = {
  list: (params?: { search?: string; role?: string; page?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.role) q.set("role", params.role);
    if (params?.page) q.set("page", String(params.page));
    const qs = q.toString();
    return request<AdminUsersPage>(
      `/api/mobile/admin/users${qs ? `?${qs}` : ""}`,
      { method: "GET" },
    );
  },
};
