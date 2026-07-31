import { Platform } from "react-native";
import { env } from "../config/env";
import { adminTokenStorage } from "./storage";

/**
 * API client for the mobile-admin booking surface. Same shape as the
 * web getAdminBookings result so the list/detail screens can lay out
 * with the same chips and pills the web admin uses.
 */

export type AdminBookingStatus =
  | "CONFIRMED"
  | "PENDING"
  | "CANCELLED"
  | "COMPLETED"
  | "ABSENT";
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
  // Optional goodwill discount applied at collection time. null when no
  // discount was used; otherwise sums alongside cash + UPI to the total
  // remainder owed at the venue.
  remainderDiscountAmount: number | null;
  razorpayPaymentId: string | null;
  utrNumber: string | null;
  confirmedAt: string | null;
}

export interface AdminClaimedPayment {
  kind: "cafe" | "pass";
  id: string;
  customer: string | null;
  label: string;
  amount: number;
  transactionId: string | null;
  claimedAt: string | null;
}

export interface AdminBookingSlot {
  startHour: number;
  price: number;
  /** Present on the detail endpoint; a 30-min admin extension row
   *  reports 30 while ordinary slots report the court's duration. */
  startMinute?: number;
  durationMinutes?: number;
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
  /** Live pass redemption on this booking (null once restored). */
  passRedemption: {
    passName: string;
    minutes: number;
    /** Rupee worth of the redeemed hours (attribution, not cash). */
    value: number;
    /** List price the pass settled — part of the owed math below. */
    coveredAmount: number;
  } | null;
  /** The pass that may cover MORE time on this booking: the attached
   *  one when a redemption is live (the server rejects any other), else
   *  the customer's soonest-expiring eligible pass. */
  extendPass: { id: string; name: string; remainingMinutes: number } | null;
  /** totalAmount − payment.amount − coveredAmount: what staff still
   *  collect at the venue (equipment, uncovered added time). */
  owedAtVenue: number;
}

export interface ListResponse {
  bookings: AdminBookingListItem[];
  /** Customer-claimed cafe/pass payments PhonePe hasn't confirmed.
   *  Present on page 1 only — a short queue, not a paginated list. */
  claims?: AdminClaimedPayment[];
  total: number;
  page: number;
  totalPages: number;
}

/**
 * Multi-select filter values for the admin bookings list. Each
 * field is a string[] — empty / undefined / containing "ALL" means
 * "no filter / show all." The mobile list screen drives these from
 * its chip UI (with the same toggle semantics as the web page);
 * `list()` serialises them to CSV when calling /api/mobile/admin/
 * bookings. Payment is multi-select syntactically but semantically
 * single-value (completed XOR pending); two values picked together
 * drop the filter, mirroring the server behaviour.
 */
export interface ListFilters {
  status?: AdminBookingStatus[];
  sport?: Array<"CRICKET" | "FOOTBALL" | "PICKLEBALL">;
  date?: string;
  platform?: Array<"web" | "android" | "ios">;
  payment?: Array<"completed" | "pending">;
  /** Free-text customer search — matches user.name (case-insensitive),
   *  user.phone (substring), or user.email (case-insensitive). Same
   *  filter the web admin /bookings page exposes. */
  q?: string;
  /** Result ordering. Defaults to "createdAt" — when the booking was
   *  placed (current behaviour). "date" sorts by the actual session
   *  date so today/tomorrow's slots line up regardless of when the
   *  bookings were created. */
  sort?: "createdAt" | "date";
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
  // Bowling-machine detection signals. Either one being set
  // ("BOWLING_MACHINE" or slotDurationMinutes === 30) flips the
  // create form into the 30-min picker — older bowling rows still
  // carry slotDurationMinutes=60 so we OR the two on the client.
  category: string | null;
  slotDurationMinutes: number;
}

export interface AvailableSlot {
  hour: number;
  price: number;
  isBooked: boolean;
  isBlocked: boolean;
  blockReason?: string | null;
}

export interface AvailableBowlingSlot {
  hour: number;
  minute: 0 | 30;
  price: number;
  isBooked: boolean;
  isBlocked: boolean;
}

export const adminBookingsApi = {
  /**
   * Same composite filter as the web /admin/bookings/unconfirmed page:
   * status PENDING + payment.status PENDING + method UPI_QR/CASH. Not
   * the same dataset as `list({ status: "PENDING" })`, which is the
   * broader "all PENDING bookings regardless of payment" view used by
   * the Pending status chip on the regular bookings list.
   */
  unconfirmed(
    filters: { page?: number; limit?: number } = {},
  ): Promise<ListResponse> {
    const params = new URLSearchParams();
    if (filters.page) params.set("page", String(filters.page));
    if (filters.limit) params.set("limit", String(filters.limit));
    const qs = params.toString();
    return request(
      `/api/mobile/admin/bookings/unconfirmed${qs ? `?${qs}` : ""}`,
      { method: "GET" },
    );
  },

  /** Helper: serialise a multi-select filter array to the CSV the
   *  server expects (or null when empty / undefined). Mobile clients
   *  pass arrays through ListFilters; this collapses them down to
   *  the wire format the /api/mobile/admin/bookings handler reads
   *  via toFilterList(). */
  list(filters: ListFilters = {}): Promise<ListResponse> {
    const params = new URLSearchParams();
    // CSV serialisation for multi-select fields. Omit when the array
    // is empty / undefined — the server treats absence as "no filter"
    // (and for status, falls back to its CONFIRMED+ABSENT default).
    const setCsv = (key: string, list: string[] | undefined) => {
      if (list && list.length > 0) params.set(key, list.join(","));
    };
    setCsv("status", filters.status);
    setCsv("sport", filters.sport);
    setCsv("platform", filters.platform);
    setCsv("payment", filters.payment);
    if (filters.date) params.set("date", filters.date);
    if (filters.q) params.set("q", filters.q);
    // Only forward sort when it's the non-default "date" value;
    // omit otherwise so the server falls through to its createdAt
    // default and the URL stays clean.
    if (filters.sort === "date") params.set("sort", "date");
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

  // Generic "force confirm" — flips PENDING → CONFIRMED regardless
  // of payment method/status. Escape hatch when the regular
  // confirm-cash / confirm-upi paths don't apply.
  confirm(id: string): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/bookings/${id}/confirm`, {
      method: "POST",
    });
  },

  // Search existing customers by name / phone / email. Returns up to
  // 10 matches; client throttles to 2+ chars before calling.
  searchCustomers(query: string): Promise<{
    customers: Array<{
      id: string;
      name: string | null;
      email: string | null;
      phone: string | null;
    }>;
  }> {
    const params = new URLSearchParams({ q: query });
    return request(
      `/api/mobile/admin/customers/search?${params.toString()}`,
      { method: "GET" },
    );
  },

  // Create a customer (or attach to existing on phone match). Used
  // by the create-booking flow when the admin types in a name+phone
  // for a customer not in the search results.
  createCustomer(body: {
    name: string;
    phone: string;
    email?: string;
  }): Promise<{ ok: true; userId: string; isNew: boolean }> {
    return request("/api/mobile/admin/customers/create", {
      method: "POST",
      body,
    });
  },

  // Available-slots check before a booking exists. Each slot tile
  // surfaces price + isBooked + isBlocked so the picker can disable
  // taken/blocked hours.
  availableSlotsForCreate(
    courtConfigId: string,
    date: string,
  ): Promise<{ slots: AvailableSlot[] }> {
    const params = new URLSearchParams({ courtConfigId, date });
    return request(
      `/api/mobile/admin/available-slots?${params.toString()}`,
      { method: "GET" },
    );
  },

  // Create a fresh booking from the mobile admin shell. Mirrors the
  // web /admin/bookings/create form's payload shape including the
  // bowling-machine 30-min branch (bowlingSlots[] instead of hours[])
  // and the optional equipment[] rentals attached at create time.
  create(body: {
    courtConfigId: string;
    date: string;
    hours: number[];
    bowlingSlots?: Array<{ hour: number; minute: 0 | 30 }>;
    userId: string;
    paymentMethod: "CASH" | "UPI_QR" | "RAZORPAY" | "FREE";
    razorpayPaymentId?: string;
    advanceAmount?: number;
    customTotalAmount?: number;
    equipment?: Array<{ equipmentId: string; quantity: number }>;
    payWithPass?: boolean;
    note?: string;
  }): Promise<{ ok: true; bookingId: string }> {
    return request("/api/mobile/admin/bookings/create", {
      method: "POST",
      body,
    });
  },

  // Would this customer's passes cover these slots? Drives the
  // "Book with customer's pass" checkbox on the create screen.
  passPreview(body: {
    userId: string;
    courtConfigId: string;
    date: string;
    hours: number[];
    bowlingSlots?: Array<{ hour: number; minute: 0 | 30 }>;
  }): Promise<{
    preview:
      | { eligible: false }
      | {
          eligible: true;
          fullCoverage: boolean;
          coveredMinutes: number;
          coveredAmount: number;
          remainderAmount: number;
          passes: { passName: string; coveredMinutes: number }[];
        };
  }> {
    return request("/api/mobile/admin/bookings/pass-preview", {
      method: "POST",
      body,
    });
  },

  // Bowling-machine 30-min slot availability for the mobile create
  // form. Server applies `adminOverride: true` so all 48 half-hour
  // slots come back regardless of operating window / past-time.
  availableBowlingSlots(
    courtConfigId: string,
    date: string,
  ): Promise<{ slots: AvailableBowlingSlot[] }> {
    const params = new URLSearchParams({ courtConfigId, date });
    return request(
      `/api/mobile/admin/available-bowling-slots?${params.toString()}`,
      { method: "GET" },
    );
  },

  // Equipment catalog filtered to a sport (+ optional category).
  // Used by the mobile create-booking form's equipment section.
  // Mirrors the web `listEquipmentForBookingCreate`.
  equipmentForBookingCreate(
    sport: string,
    category: string | null,
  ): Promise<{ items: AdminEquipmentCatalogItem[] }> {
    const params = new URLSearchParams({ sport });
    if (category) params.set("category", category);
    return request(
      `/api/mobile/admin/equipment-for-booking?${params.toString()}`,
      { method: "GET" },
    );
  },

  // Edit any payment field on an existing booking (method, status,
  // total, advance, gateway IDs). Fields omitted are left as-is on
  // the server; null clears the gateway-id fields explicitly.
  editPayment(
    id: string,
    body: {
      method?: AdminPaymentMethod;
      status?: AdminPaymentStatus;
      totalAmount?: number;
      advanceAmount?: number | null;
      isPartialPayment?: boolean;
      razorpayPaymentId?: string | null;
      utrNumber?: string | null;
      note?: string;
    },
  ): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/bookings/${id}/edit-payment`, {
      method: "POST",
      body,
    });
  },

  cancel(id: string, reason: string): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/bookings/${id}/cancel`, {
      method: "POST",
      body: { reason },
    });
  },

  /**
   * Closes a CONFIRMED booking out as COMPLETED — customer
   * attended, advance kept as earnings, remainder (if any)
   * forfeit. Mirror of the web "Mark Completed" admin action.
   */
  markCompleted(id: string): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/bookings/${id}/mark-completed`, {
      method: "POST",
    });
  },

  /**
   * Closes a CONFIRMED booking out as ABSENT — customer no-show,
   * advance kept as earnings, remainder forfeit.
   */
  markAbsent(id: string): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/bookings/${id}/mark-absent`, {
      method: "POST",
    });
  },

  // Three-leg venue collection: cash + UPI + optional goodwill
  // discount. discountAmount is treated as 0 when the screen passes
  // undefined, preserving the previous two-input behaviour.
  markCollected(
    id: string,
    cashAmount: number,
    upiAmount: number,
    discountAmount: number = 0,
  ): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/bookings/${id}/mark-collected`, {
      method: "POST",
      body: { cashAmount, upiAmount, discountAmount },
    });
  },

  editSplit(
    id: string,
    cashAmount: number,
    upiAmount: number,
    discountAmount: number = 0,
  ): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/bookings/${id}/edit-split`, {
      method: "POST",
      body: { cashAmount, upiAmount, discountAmount },
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
    body: {
      hours: number[];
      /** Bowling-machine 30-min picks. Mutually exclusive with hours[]
       *  — the server rejects whichever shape doesn't match the court's
       *  slot duration, so a 30-min court must send these with hours: []. */
      bowlingSlots?: Array<{ hour: number; minute: 0 | 30 }>;
      date?: string;
      /** Debit the ADDED minutes from the customer's eligible pass
       *  instead of charging them. Server re-validates balance, court
       *  group and play date. */
      coverDeltaWithPass?: boolean;
    },
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
      /** See editSlots — covers added time from an eligible pass. */
      coverDeltaWithPass?: boolean;
    },
  ): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/bookings/${id}/edit-booking`, {
      method: "POST",
      body,
    });
  },

  /**
   * Quick +30 min admin extension — gives the court 30 min early
   * (direction "before") or extends past the booked end (direction
   * "after"). Hard-blocks on adjacent-booking conflicts server-side.
   *
   * `price` is what the admin chose to charge for the extra 30 min;
   * 0 = free / courtesy. Use `suggestedExtendPrice` first to pre-fill
   * the input with a sensible default (half the adjacent slot's rate).
   */
  extend(
    id: string,
    body: {
      direction: "before" | "after";
      price: number;
      /** Take the 30 min from this pass instead of charging. Must be
       *  the booking's redeemed pass when one is live — the server
       *  rejects a different id rather than debiting the wrong pass. */
      payWithPassId?: string;
    },
  ): Promise<{
    ok: true;
    newSlot: {
      startHour: number;
      startMinute: number;
      durationMinutes: 30;
      price: number;
      label: string;
    };
  }> {
    return request(`/api/mobile/admin/bookings/${id}/extend`, {
      method: "POST",
      body,
    });
  },

  /** Resolve a claimed cafe/pass payment — see the web
   *  "Unconfirmed Payments" actions; the server action is shared. */
  resolveClaim(
    kind: "cafe" | "pass",
    intentId: string,
    mode: "verify" | "force" | "reject",
  ): Promise<
    | { ok: true; id?: string; via?: "gateway" | "manual"; rejected?: boolean }
    | { ok: false; error: string }
  > {
    return request("/api/mobile/admin/claimed-payments", {
      method: "POST",
      body: { kind, intentId, mode },
    });
  },

  suggestedExtendPrice(
    id: string,
    direction: "before" | "after",
  ): Promise<{ suggestedPrice: number }> {
    return request(
      `/api/mobile/admin/bookings/${id}/extend?direction=${direction}`,
      { method: "GET" },
    );
  },

  availableSlots(
    bookingId: string,
    courtConfigId: string,
    date: string,
  ): Promise<{ slots: AvailableSlot[] }> {
    const params = new URLSearchParams({ courtConfigId, date });
    return request(
      `/api/mobile/admin/bookings/${bookingId}/available-slots?${params.toString()}`,
      { method: "GET" },
    );
  },

  courts(): Promise<{ courts: AdminCourt[] }> {
    return request("/api/mobile/admin/courts", { method: "GET" });
  },

  /** Equipment editor — snapshot + catalog for a booking. Mirrors
   *  the web /admin/bookings/[id] page's EquipmentEditor. */
  equipmentSnapshot(
    id: string,
  ): Promise<{
    rentals: AdminEquipmentRow[];
    catalog: AdminEquipmentCatalogItem[];
    equipmentTotalRupees: number;
    bookingTotalRupees: number;
  }> {
    return request(`/api/mobile/admin/bookings/${id}/equipment`, {
      method: "GET",
    });
  },

  equipmentMutate(
    id: string,
    body:
      | { op: "add"; equipmentId: string; quantity: number }
      | { op: "update"; rentalId: string; quantity: number }
      | { op: "remove"; rentalId: string },
  ): Promise<{
    success: boolean;
    error?: string;
    rentals?: AdminEquipmentRow[];
    equipmentTotalRupees?: number;
    bookingTotalRupees?: number;
  }> {
    return request(`/api/mobile/admin/bookings/${id}/equipment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
};

export interface AdminEquipmentRow {
  id: string;
  equipmentId: string;
  name: string;
  quantity: number;
  pricePerUnitPaise: number;
  totalPricePaise: number;
}

export interface AdminEquipmentCatalogItem {
  id: string;
  name: string;
  pricePerUnitPaise: number;
  sport: string | null;
  category: string | null;
}
