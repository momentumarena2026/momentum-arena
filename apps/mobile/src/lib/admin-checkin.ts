import { request } from "./admin-api";
import type {
  AdminBookingStatus,
  AdminPaymentMethod,
  AdminPaymentStatus,
} from "./admin-bookings";

/**
 * API client for the mobile-admin check-in surface. Two modes:
 *   - "today": floor-staff lookup of today's confirmed bookings, with
 *     name/phone search built into the screen on top of this list.
 *   - "by-qr": same lookup the web /admin/checkin?token=... page does
 *     after a camera scan.
 *
 * The web admin uses a camera-driven QR scanner; on mobile we keep
 * the manual entry + today-list path so a staffer without a working
 * camera permission can still check guests in.
 */

export interface CheckinTodayItem {
  id: string;
  qrToken: string;
  checkedInAt: string | null;
  user: {
    id: string;
    name: string | null;
    phone: string | null;
  };
  courtConfig: {
    sport: "CRICKET" | "FOOTBALL" | "PICKLEBALL";
    label: string;
    size: string;
  };
  slots: number[];
  totalAmount: number;
  paymentStatus: AdminPaymentStatus | null;
  paymentMethod: AdminPaymentMethod | null;
}

export interface CheckinByQrBooking {
  id: string;
  qrToken: string;
  date: string;
  status: AdminBookingStatus;
  totalAmount: number;
  checkedInAt: string | null;
  user: {
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  courtConfig: {
    id: string;
    sport: "CRICKET" | "FOOTBALL" | "PICKLEBALL";
    label: string;
    size: string;
  };
  slots: { startHour: number }[];
  payment: {
    status: AdminPaymentStatus;
    method: AdminPaymentMethod;
  } | null;
}

export const adminCheckinApi = {
  today(): Promise<{ date: string; bookings: CheckinTodayItem[] }> {
    return request("/api/mobile/admin/checkin/today", { method: "GET" });
  },

  byQr(qrToken: string): Promise<{ booking: CheckinByQrBooking }> {
    const params = new URLSearchParams({ qrToken });
    return request(
      `/api/mobile/admin/checkin/by-qr?${params.toString()}`,
      { method: "GET" },
    );
  },

  checkIn(qrToken: string): Promise<{ ok: true }> {
    return request("/api/mobile/admin/checkin/check-in", {
      method: "POST",
      body: { qrToken },
    });
  },
};
