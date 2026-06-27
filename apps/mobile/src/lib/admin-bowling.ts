import { request } from "./admin-api";

export type BowlingHalf = "LEFT" | "RIGHT";
export type BowlingDayType = "WEEKDAY" | "WEEKEND";

export interface BowlingWindow {
  id?: string;
  dayType: BowlingDayType;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  sortOrder?: number;
}

export interface BowlingSettings {
  id: string;
  label: string;
  half: BowlingHalf;
  slotDurationMinutes: number;
  isActive: boolean;
  windows: BowlingWindow[];
}

export const adminBowlingApi = {
  get: () =>
    request<{ settings: BowlingSettings | null }>("/api/mobile/admin/bowling", {
      method: "GET",
    }),
  setEnabled: (enabled: boolean) =>
    request<{ ok: true }>("/api/mobile/admin/bowling", {
      method: "POST",
      body: { action: "enabled", enabled },
    }),
  setHalf: (half: BowlingHalf) =>
    request<{ ok: true }>("/api/mobile/admin/bowling", {
      method: "POST",
      body: { action: "half", half },
    }),
  setWindows: (
    windows: Array<Omit<BowlingWindow, "id" | "sortOrder">>,
  ) =>
    request<{ ok: true }>("/api/mobile/admin/bowling", {
      method: "POST",
      body: { action: "windows", windows },
    }),
};
