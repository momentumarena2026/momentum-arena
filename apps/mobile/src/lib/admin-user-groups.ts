import { request } from "./admin-api";

export interface AdminUserGroup {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  couponCount: number;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserGroupInput {
  name: string;
  description?: string;
}

export interface UpdateUserGroupInput {
  name?: string;
  description?: string | null;
}

export const adminUserGroupsApi = {
  list: (search?: string) => {
    const qs = search ? `?search=${encodeURIComponent(search)}` : "";
    return request<{ groups: AdminUserGroup[] }>(
      `/api/mobile/admin/user-groups${qs}`,
      { method: "GET" },
    );
  },
  create: (body: CreateUserGroupInput) =>
    request<{ ok: true; groupId: string }>("/api/mobile/admin/user-groups", {
      method: "POST",
      body,
    }),
  update: (id: string, body: UpdateUserGroupInput) =>
    request<{ ok: true }>(`/api/mobile/admin/user-groups/${id}`, {
      method: "PATCH",
      body,
    }),
  remove: (id: string) =>
    request<{ ok: true }>(`/api/mobile/admin/user-groups/${id}`, {
      method: "DELETE",
    }),
};
