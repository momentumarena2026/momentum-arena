import { request } from "./admin-api";

/**
 * Bearer client for the trusted-device allowlist (5-tap admin entry
 * gate). Mirror of the web /admin/trusted-devices module — same
 * MANAGE_TRUSTED_DEVICES permission server-side.
 */

export interface AdminTrustedDevice {
  id: string;
  deviceId: string;
  label: string;
  platform: string | null;
  source: string; // "MANUAL" | "LOGIN"
  createdAt: string;
  lastSeenAt: string;
}

export const adminTrustedDevicesApi = {
  list: () =>
    request<{ devices: AdminTrustedDevice[] }>(
      "/api/mobile/admin/trusted-devices",
      { method: "GET" },
    ),

  add: (input: { deviceId: string; label: string; platform?: string }) =>
    request<{ ok: boolean }>("/api/mobile/admin/trusted-devices", {
      method: "POST",
      body: input,
    }),

  rename: (id: string, label: string) =>
    request<{ ok: boolean }>("/api/mobile/admin/trusted-devices", {
      method: "PATCH",
      body: { id, label },
    }),

  remove: (id: string) =>
    request<{ ok: boolean }>(
      `/api/mobile/admin/trusted-devices?id=${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
};
