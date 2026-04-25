import { api } from "./api";
import type {
  Booking,
  BookingsListResponse,
  BookingStatus,
  CourtConfig,
  DashboardResponse,
  RecurringListResponse,
  Sport,
} from "./types";

export const bookingsApi = {
  dashboard: () => api.get<DashboardResponse>("/api/mobile/dashboard"),

  list: (params?: { status?: BookingStatus; page?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return api.get<BookingsListResponse>(
      `/api/mobile/bookings${qs ? `?${qs}` : ""}`
    );
  },

  detail: (bookingId: string) =>
    api.get<Booking>(`/api/mobile/bookings/${bookingId}`),

  recurring: () =>
    api.get<RecurringListResponse>("/api/mobile/recurring"),

  courts: (sport: Sport) =>
    api.get<CourtConfig[]>(`/api/mobile/courts?sport=${sport}`, {
      auth: false,
    }),
};
