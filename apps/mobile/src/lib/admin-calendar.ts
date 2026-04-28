import { request } from "./admin-api";

/**
 * API client for the admin booking calendar. Mirrors the shape the
 * web `getCalendarData` server action returns so the RN screen can
 * render the same court×hour grid as /admin/calendar.
 *
 * `grid` is a sparse `configId -> hour -> CellData` map — only cells
 * that contain a booking or block are populated. Empty cells are
 * "available" and rendered as a price-only chip on the client.
 */

export type AdminCalendarSport = "CRICKET" | "FOOTBALL" | "PICKLEBALL";
// Mirror Prisma `ConfigSize` so the UI can chip on size if needed
// without re-parsing strings. Kept as a string union (instead of
// importing from @prisma/client) because the mobile app doesn't
// pull the Prisma client into its bundle.
export type AdminCalendarConfigSize =
  | "XS"
  | "SMALL"
  | "MEDIUM"
  | "LARGE"
  | "XL"
  | "FULL"
  | "SHARED";
export type AdminCalendarZone =
  | "LEATHER_1"
  | "BOX_A"
  | "BOX_B"
  | "LEATHER_2"
  | "SHARED_COURT";

export interface CellBooking {
  id: string;
  status: "CONFIRMED" | "PENDING";
  userName: string;
  userEmail: string | null;
  userPhone: string | null;
  slots: number[];
  totalAmount: number;
  paymentStatus: string | null;
  paymentMethod: string | null;
}

export interface CellData {
  booking?: CellBooking;
  blocked?: boolean;
  blockReason?: string;
}

export interface CalendarConfig {
  id: string;
  sport: AdminCalendarSport;
  size: AdminCalendarConfigSize;
  label: string;
  position: string;
  zones: AdminCalendarZone[];
}

export interface CalendarData {
  configs: CalendarConfig[];
  grid: Record<string, Record<number, CellData>>;
  hours: number[];
}

export const adminCalendarApi = {
  /**
   * date — IST YYYY-MM-DD; sport — optional sport filter. Same input
   * shape the web /admin/calendar page uses, so the cache key on the
   * RN side stays portable.
   */
  data(date: string, sport?: AdminCalendarSport): Promise<CalendarData> {
    const params = new URLSearchParams({ date });
    if (sport) params.set("sport", sport);
    return request(`/api/mobile/admin/calendar?${params.toString()}`, {
      method: "GET",
    });
  },
};
