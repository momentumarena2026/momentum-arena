import { Platform } from "react-native";
import { env } from "../config/env";
import { adminTokenStorage } from "./storage";

/**
 * API client for the mobile-admin booking surface. Same shape as the
 * web getAdminBookings result so the list/detail screens can lay out
 * with the same chips and pills the web admin uses.
 */

export type AdminBookingStatus = "CONFIRMED" | "PENDING" | "CANCELLED";
export type AdminPaymentStatus =
  | "PENDING"
  | "PARTIAL"
  | "COMPLETED"
  | "REFUNDED"
  | "FAILED";
export type AdminPaymentMethod =
  | "RAZORPAY"
  | "PHONEPE"
  | "UPI_QR"
  | "CASH"
  | "FREE";

export interface AdminBookingPayment {
  id: string;
  method: AdminPaymentMethod;
  status: AdminPaymentStatus;
  amount: number;
  isPartialPayment: boolean;
  advanceAmount: number | null;
  remainingAmount: number | null;
  remainderMethod: AdminPaymentMethod | null;
  remainderCashAmount: number | null;
  remainderUpiAmount: number | null;
  razorpayPaymentId: string | null;
  utrNumber: string | null;
  confirmedAt: string | null;
}

export interface AdminBookingSlot {
  startHour: number;
  price: number;
}

export interface AdminBookingListItem {
  id: string;
  date: string;
  status: AdminBookingStatus;
  totalAmount: number;
  originalAmount: number | null;
  discountAmount: number;
  createdAt: string;
  createdByAdminId: string | null;
  recurringBookingId: string | null;
  platform: string;
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
  slots: AdminBookingSlot[];
  payment: AdminBookingPayment | null;
  _isRecurringChildPayment: boolean;
}

export interface AdminBookingDetail extends Omit<AdminBookingListItem, "courtConfig"> {
  user: AdminBookingListItem["user"] & { email: string | null };
  // Detail endpoint returns the full court config (incl. id) so the
  // edit screens can pre-fill the picker; the list endpoint trims to
  // the display fields only.
  courtConfig: AdminBookingListItem["courtConfig"] & { id: string };
  qrToken: string | null;
  checkedInAt: string | null;
  editHistory: Array<{
    id: string;
    editType: string;
    adminUsername: string;
    note: string | null;
    createdAt: string;
    previousAmount: number | null;
    newAmount: number | null;
  }>;
}

export interface ListResponse {
  bookings: AdminBookingListItem[];
  total: number;
  page: number;
  totalPages: number;
}

export interface ListFilters {
  status?: "ALL" | "CONFIRMED" | "PENDING" | "CANCELLED";
  sport?: "CRICKET" | "FOOTBALL" | "PICKLEBALL";
  date?: string;
  platform?: "web" | "android" | "ios";
  page?: number;
  limit?: number;
}

export class AdminApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<T> {
  const token = await adminTokenStorage.read();
  if (!token) throw new AdminApiError("Not signed in as admin", 401);

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "X-Platform": Platform.OS === "ios" ? "ios" : "android",
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (err) {
    throw new AdminApiError(
      err instanceof Error ? err.message : "Network error",
      0,
    );
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const msg =
      (payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : null) || `Request failed with ${res.status}`;
    throw new AdminApiError(msg, res.status);
  }

  return payload as T;
}

export interface AdminCourt {
  id: string;
  sport: "CRICKET" | "FOOTBALL" | "PICKLEBALL";
  label: string;
  size: string;
  position: string;
  widthFt: number;
  lengthFt: number;
}

export interface AvailableSlot {
  hour: number;
  price: number;
  isBooked: boolean;
  isBlocked: boolean;
  blockReason?: string | null;
}

export const adminBookingsApi = {
  list(filters: ListFilters = {}): Promise<ListResponse> {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.sport) params.set("sport", filters.sport);
    if (filters.date) params.set("date", filters.date);
    if (filters.platform) params.set("platform", filters.platform);
    if (filters.page) params.set("page", String(filters.page));
    if (filters.limit) params.set("limit", String(filters.limit));
    const qs = params.toString();
    return request(`/api/mobile/admin/bookings${qs ? `?${qs}` : ""}`, {
      method: "GET",
    });
  },

  detail(id: string): Promise<{ booking: AdminBookingDetail }> {
    return request(`/api/mobile/admin/bookings/${id}`, { method: "GET" });
  },

  confirmUpi(id: string): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/bookings/${id}/confirm-upi`, {
      method: "POST",
    });
  },

  confirmCash(id: string): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/bookings/${id}/confirm-cash`, {
      method: "POST",
    });
  },

  cancel(id: string, reason: string): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/bookings/${id}/cancel`, {
      method: "POST",
      body: { reason },
    });
  },

  markCollected(
    id: string,
    cashAmount: number,
    upiAmount: number,
  ): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/bookings/${id}/mark-collected`, {
      method: "POST",
      body: { cashAmount, upiAmount },
    });
  },

  editSplit(
    id: string,
    cashAmount: number,
    upiAmount: number,
  ): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/bookings/${id}/edit-split`, {
      method: "POST",
      body: { cashAmount, upiAmount },
    });
  },

  refund(
    id: string,
    body: {
      reason: string;
      refundMethod?: "ORIGINAL" | "CASH" | "UPI" | "BANK_TRANSFER";
      refundAmount?: number;
    },
  ): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/bookings/${id}/refund`, {
      method: "POST",
      body,
    });
  },

  editSlots(
    id: string,
    body: { hours: number[]; date?: string },
  ): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/bookings/${id}/edit-slots`, {
      method: "POST",
      body,
    });
  },

  editBooking(
    id: string,
    body: {
      newDate?: string;
      newCourtConfigId?: string;
      newHours?: number[];
      newAdvanceAmount?: number;
      newAdvanceMethod?: "CASH" | "UPI_QR";
    },
  ): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/bookings/${id}/edit-booking`, {
      method: "POST",
      body,
    });
  },

  availableSlots(
    bookingId: string,
    courtConfigId: string,
    date: string,
  ): Promise<{
    slots: AvailableSlot[];
    pricingExists: boolean;
  }> {
    const params = new URLSearchParams({ courtConfigId, date });
    return request(
      `/api/mobile/admin/bookings/${bookingId}/available-slots?${params.toString()}`,
      { method: "GET" },
    );
  },

  courts(): Promise<{ courts: AdminCourt[] }> {
    return request("/api/mobile/admin/courts", { method: "GET" });
  },
};
