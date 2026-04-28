import { request } from "./admin-api";
import type { AdminCalendarSport } from "./admin-calendar";

/**
 * API client for the admin slot-blocks surface. Mirrors the web
 * /admin/slots page — list + create + delete blocks for a single
 * date. Granularity matches the web schema: a block can target an
 * entire day, a specific hour, a sport, a court config, or any
 * combination — fields left null mean "applies to all".
 */

export interface AdminSlotBlock {
  id: string;
  date: string;
  startHour: number | null;
  sport: AdminCalendarSport | null;
  courtConfig: {
    id: string;
    sport: AdminCalendarSport;
    label: string;
    size: string;
  } | null;
  reason: string | null;
  createdAt: string;
}

export interface CreateBlockBody {
  date: string;
  courtConfigId?: string;
  sport?: AdminCalendarSport;
  startHour?: number;
  reason?: string;
}

export const adminSlotsApi = {
  list(date: string): Promise<{ blocks: AdminSlotBlock[] }> {
    const params = new URLSearchParams({ date });
    return request(`/api/mobile/admin/slot-blocks?${params.toString()}`, {
      method: "GET",
    });
  },

  create(body: CreateBlockBody): Promise<{ ok: true }> {
    return request("/api/mobile/admin/slot-blocks", {
      method: "POST",
      body,
    });
  },

  remove(id: string): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/slot-blocks/${id}`, {
      method: "DELETE",
    });
  },
};
