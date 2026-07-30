import { request } from "./admin-api";
import type { AdminPermission } from "./admin-permissions";

/**
 * Mobile admin-account management client (db.adminUser) — SUPERADMIN only.
 * Manages other admin accounts: create / edit / delete + role + permission
 * bits. NOT the same as the customer-user APIs.
 */

export type AdminAccountRole = "SUPERADMIN" | "ADMIN" | "STAFF";

export interface AdminAccount {
  id: string;
  username: string;
  email: string;
  role: AdminAccountRole;
  permissions: string[];
  isDeletable: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  passwordSet: boolean;
}

export interface CreateAdminAccountBody {
  username: string;
  email: string;
  password: string;
  role: "ADMIN" | "STAFF";
  permissions: AdminPermission[];
}

export interface UpdateAdminAccountBody {
  email?: string;
  role?: "ADMIN" | "STAFF";
  permissions?: AdminPermission[];
  /** Optional new password (admin reset). Leave undefined to keep current. */
  password?: string;
  /** false = blocked from logging in; live sessions die on their next request. */
  isActive?: boolean;
}

export const adminAdminUsersApi = {
  list: () =>
    request<{ admins: AdminAccount[] }>("/api/mobile/admin/admin-users", {
      method: "GET",
    }),

  create: (body: CreateAdminAccountBody) =>
    request<{ admin: AdminAccount }>("/api/mobile/admin/admin-users", {
      method: "POST",
      body,
    }),

  update: (id: string, body: UpdateAdminAccountBody) =>
    request<{ admin: AdminAccount }>(`/api/mobile/admin/admin-users/${id}`, {
      method: "PATCH",
      body,
    }),

  remove: (id: string) =>
    request<{ ok: true }>(`/api/mobile/admin/admin-users/${id}`, {
      method: "DELETE",
    }),
};
