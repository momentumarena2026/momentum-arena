import { request } from "./admin-api";

export type AdminUserRole = "CUSTOMER" | "ADMIN" | "SUPERADMIN";

/** Editable role — web only ever creates/edits CUSTOMER or ADMIN. */
export type EditableUserRole = "CUSTOMER" | "ADMIN";

export interface AdminUser {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: AdminUserRole;
  bookingCount: number;
  /** ISO timestamp, or null when the user is not soft-deleted. */
  deletedAt: string | null;
  /** ISO timestamp. */
  createdAt: string;
}

export interface AdminUsersPage {
  users: AdminUser[];
  total: number;
  page: number;
  totalPages: number;
}

export interface CreateUserInput {
  name: string;
  email?: string;
  phone?: string;
  role: EditableUserRole;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  phone?: string;
  role?: EditableUserRole;
}

export const adminUsersApi = {
  list: (params?: {
    search?: string;
    role?: string;
    page?: number;
    showDeleted?: boolean;
  }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.role) q.set("role", params.role);
    if (params?.page) q.set("page", String(params.page));
    if (params?.showDeleted) q.set("showDeleted", "1");
    const qs = q.toString();
    return request<AdminUsersPage>(
      `/api/mobile/admin/users${qs ? `?${qs}` : ""}`,
      { method: "GET" },
    );
  },

  create: (body: CreateUserInput) =>
    request<{ ok: true }>("/api/mobile/admin/users", {
      method: "POST",
      body,
    }),

  update: (id: string, body: UpdateUserInput) =>
    request<{ ok: true }>(`/api/mobile/admin/users/${id}`, {
      method: "PATCH",
      body,
    }),

  /** Soft-delete (sets deletedAt). */
  remove: (id: string) =>
    request<{ ok: true }>(`/api/mobile/admin/users/${id}`, {
      method: "DELETE",
    }),

  restore: (id: string) =>
    request<{ ok: true }>(`/api/mobile/admin/users/${id}/restore`, {
      method: "POST",
    }),
};
