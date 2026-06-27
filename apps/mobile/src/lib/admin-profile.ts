import { request } from "./admin-api";

/**
 * Mobile "My profile" client — the signed-in admin views and edits their own
 * account. Available to every admin (no permission gate). The server resolves
 * the caller from the bearer token, so an admin can only ever edit themselves.
 */

export interface AdminProfile {
  id: string;
  username: string;
  email: string;
  role: "SUPERADMIN" | "ADMIN" | "STAFF";
  permissions: string[];
  lastLoginAt: string | null;
  createdAt: string;
}

export interface UpdateAdminProfileBody {
  username?: string;
  email?: string;
  /** Both required together to change the password. */
  currentPassword?: string;
  newPassword?: string;
}

export const adminProfileApi = {
  get: () =>
    request<{ profile: AdminProfile }>("/api/mobile/admin/profile", {
      method: "GET",
    }),

  update: (body: UpdateAdminProfileBody) =>
    request<{ profile: AdminProfile }>("/api/mobile/admin/profile", {
      method: "PATCH",
      body,
    }),
};
