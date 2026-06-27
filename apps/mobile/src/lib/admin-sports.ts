import { request } from "./admin-api";

export interface AdminCourtConfig {
  id: string;
  sport: string;
  size: string;
  label: string;
  position: string;
  isActive: boolean;
  category: string | null;
}

export const adminSportsApi = {
  list: () =>
    request<{ configs: AdminCourtConfig[] }>("/api/mobile/admin/sports", {
      method: "GET",
    }),
  toggleConfig: (configId: string, isActive: boolean) =>
    request<{ ok: true }>("/api/mobile/admin/sports", {
      method: "POST",
      body: { configId, isActive },
    }),
  toggleSport: (sport: string, isActive: boolean) =>
    request<{ ok: true }>("/api/mobile/admin/sports", {
      method: "POST",
      body: { sport, isActive },
    }),
};
