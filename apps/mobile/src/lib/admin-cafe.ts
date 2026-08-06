import { request } from "./admin-api";

/**
 * API client for the mobile-admin cafe surface. Two halves:
 *   - Menu (items): list + per-item availability toggle.
 *   - Orders (kanban): live grouped lanes + status transitions + cancel.
 *
 * Order create/edit are intentionally not ported to mobile yet — the
 * customer app already creates orders, and the floor staff workflow
 * is "advance status / cancel", which is what this surface covers.
 */

export type CafeItemCategory =
  | "SNACKS"
  | "BEVERAGES"
  | "MEALS"
  | "DESSERTS"
  | "COMBOS";

export type CafeOrderStatus =
  | "PENDING"
  | "PREPARING"
  | "READY"
  | "COMPLETED"
  | "CANCELLED";

export interface CafeItem {
  id: string;
  name: string;
  description: string | null;
  category: CafeItemCategory;
  price: number;
  // Cost-of-goods in rupees — null = "unknown margin" (not zero).
  costPrice: number | null;
  // Stock counter — null = unlimited / kitchen-prepared (PREP),
  // integer = on-hand count for ready-to-serve (READY) items.
  quantity: number | null;
  image: string | null;
  isVeg: boolean;
  isAvailable: boolean;
  tags: string[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Payload for create/update. Mirrors the web add/edit form fields.
 * `quantity` doubles as the PREP vs READY switch: null = kitchen-
 * prepared (PREP, no stock tracking), an integer = ready-to-serve
 * (READY, stock-tracked). `costPrice: null` clears a set cost.
 */
export interface CafeItemInput {
  name: string;
  description?: string | null;
  category: CafeItemCategory;
  price: number;
  costPrice?: number | null;
  quantity?: number | null;
  isVeg: boolean;
  tags?: string[];
}

export interface CafeOrderLine {
  id: string;
  quantity: number;
  itemName: string;
  unitPrice: number;
  isVeg: boolean | null;
}

export interface CafeOrderListItem {
  id: string;
  orderNumber: string;
  status: CafeOrderStatus;
  totalAmount: number;
  /** Still owed on a part-paid order. 0 when square. Derived server-side by
   *  getCafeOrders (total minus counter payment minus settlements), never
   *  stored — a stored balance goes stale the moment an order is edited. */
  dueAmount?: number;
  createdAt: string;
  note: string | null;
  guestName: string | null;
  guestPhone: string | null;
  user: {
    id: string;
    name: string | null;
    phone: string | null;
  } | null;
  items: CafeOrderLine[];
  payment: {
    status: string;
    method: string;
  } | null;
}

/** One page of order history from /orders/list. */
/** A row as the history list renders it: payment flattened onto the order.
 *  Named so the order-detail route can take one as a param. */
export type CafeOrderHistoryRow = Omit<CafeOrderListItem, "payment"> & {
  paymentMethod: string | null;
  paymentStatus: string | null;
};

export interface CafeOrderHistoryPage {
  total: number;
  totalPages: number;
  orders: CafeOrderHistoryRow[];
}

export interface LiveCafeOrders {
  PENDING: CafeOrderListItem[];
  PREPARING: CafeOrderListItem[];
  READY: CafeOrderListItem[];
}

export interface CafeOrderStats {
  todayOrders: number;
  todayRevenue: number;
  pendingCount: number;
  popularItems: { name: string; quantity: number }[];
}

export const adminCafeApi = {
  items(filters?: {
    category?: CafeItemCategory;
    search?: string;
    showUnavailable?: boolean;
  }): Promise<{
    items: CafeItem[];
    grouped: Record<string, CafeItem[]>;
  }> {
    const params = new URLSearchParams();
    if (filters?.category) params.set("category", filters.category);
    if (filters?.search) params.set("search", filters.search);
    if (filters?.showUnavailable === false) params.set("showUnavailable", "0");
    const qs = params.toString();
    return request(
      `/api/mobile/admin/cafe/items${qs ? `?${qs}` : ""}`,
      { method: "GET" },
    );
  },

  toggleAvailability(
    id: string,
  ): Promise<{ ok: true; isAvailable: boolean }> {
    return request(`/api/mobile/admin/cafe/items/${id}/availability`, {
      method: "POST",
    });
  },

  /** Create a new menu item. */
  createItem(body: CafeItemInput): Promise<{ ok: true; item: CafeItem }> {
    return request("/api/mobile/admin/cafe/items", { method: "POST", body });
  },

  /** Edit an existing menu item. Send only the fields that changed. */
  updateItem(
    id: string,
    body: Partial<CafeItemInput>,
  ): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/cafe/items/${id}`, {
      method: "PATCH",
      body,
    });
  },

  /** Soft-delete (mark unavailable) a menu item. */
  removeItem(id: string): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/cafe/items/${id}`, { method: "DELETE" });
  },

  /** Read the master CafeSettings.isOpen flag. */
  getOpen(): Promise<{ isOpen: boolean }> {
    return request("/api/mobile/admin/cafe/open", { method: "GET" });
  },

  /** Flip the master CafeSettings.isOpen flag. */
  setOpen(isOpen: boolean): Promise<{ ok: true; isOpen: boolean }> {
    return request("/api/mobile/admin/cafe/open", {
      method: "POST",
      body: { isOpen },
    });
  },

  liveOrders(): Promise<LiveCafeOrders> {
    return request("/api/mobile/admin/cafe/orders/live", { method: "GET" });
  },

  /** Paginated order HISTORY (the live board only shows the open queue). */
  listOrders(filters: {
    date?: string;
    status?: CafeOrderStatus | "";
    search?: string;
    page?: number;
  }): Promise<CafeOrderHistoryPage> {
    const q = new URLSearchParams();
    if (filters.date) q.set("date", filters.date);
    if (filters.status) q.set("status", filters.status);
    if (filters.search) q.set("search", filters.search);
    q.set("page", String(filters.page ?? 1));
    return request(`/api/mobile/admin/cafe/orders/list?${q.toString()}`, {
      method: "GET",
    });
  },

  orderStats(): Promise<CafeOrderStats> {
    return request("/api/mobile/admin/cafe/orders/stats", { method: "GET" });
  },

  setOrderStatus(
    id: string,
    newStatus: CafeOrderStatus,
  ): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/cafe/orders/${id}/status`, {
      method: "POST",
      body: { newStatus },
    });
  },

  cancelOrder(id: string, reason: string): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/cafe/orders/${id}/cancel`, {
      method: "POST",
      body: { reason },
    });
  },

  /** Admin rings up a walk-in / phone-first order. */
  createOrder(body: {
    items: { cafeItemId: string; quantity: number }[];
    customerPhone?: string;
    customerName?: string;
    discountAmount?: number;
    paymentMethod: "CASH" | "UPI_QR";
    split?: { cashAmount: number; upiAmount: number };
    note?: string;
  }): Promise<{ ok: true; orderId: string; orderNumber: string }> {
    return request("/api/mobile/admin/cafe/orders/create", {
      method: "POST",
      body,
    });
  },
};


/**
 * Part-paid orders: the outstanding balance and collecting it.
 *
 * Mirrors the web admin's CafeDuePanel. Amounts are rupees, and receivedAt
 * is a date-only string — the day the money arrived is what revenue keys
 * on, so it must be sendable rather than assumed to be today.
 */
export interface CafeDue {
  orderId: string;
  orderNumber: string;
  totalAmount: number;
  collectedAtCounter: number;
  collectedLater: number;
  dueAmount: number;
  settlements: {
    id: string;
    amount: number;
    cashAmount: number;
    upiAmount: number;
    method: string;
    receivedAt: string;
    note: string | null;
  }[];
}

export async function getCafeOrderDue(orderId: string): Promise<CafeDue> {
  return request<CafeDue>(
    `/api/mobile/admin/cafe/orders/due?orderId=${encodeURIComponent(orderId)}`,
    { method: "GET" },
  );
}

export async function settleCafeOrderDue(input: {
  orderId: string;
  cashAmount: number;
  upiAmount: number;
  receivedAt?: string;
  note?: string;
}): Promise<{ success: true; dueAmount: number } | { success: false; error: string }> {
  return request<{ success: true; dueAmount: number } | { success: false; error: string }>(
    "/api/mobile/admin/cafe/orders/due",
    { method: "POST", body: input },
  );
}


/** One edit-history row on a cafe order. */
export interface CafeOrderEdit {
  id: string;
  adminUsername: string;
  /// ITEMS_ADDED | ITEMS_REMOVED | QUANTITY_CHANGED | STATUS_CHANGED |
  /// ORDER_CANCELLED | ORDER_CREATED
  editType: string;
  previousAmount: number | null;
  newAmount: number | null;
  note: string | null;
  createdAt: string;
}

/**
 * Editing an order's items and reading its change history.
 *
 * Both go through the same server actions the web admin uses, so the
 * stock guard, the total recalculation and the history write stay in one
 * implementation — the app never recomputes an order total itself.
 */
export async function addOrderItems(
  orderId: string,
  items: { cafeItemId: string; quantity: number }[],
): Promise<{ success: true }> {
  return request(`/api/mobile/admin/cafe/orders/${orderId}/items`, {
    method: "POST",
    body: { op: "add", items },
  });
}

export async function cancelOrderItems(
  orderId: string,
  orderItemIds: string[],
): Promise<{ success: true }> {
  return request(`/api/mobile/admin/cafe/orders/${orderId}/items`, {
    method: "POST",
    body: { op: "cancel", orderItemIds },
  });
}

export async function getOrderHistory(
  orderId: string,
): Promise<{ history: CafeOrderEdit[] }> {
  return request(`/api/mobile/admin/cafe/orders/${orderId}/history`, {
    method: "GET",
  });
}
