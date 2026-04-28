import { request } from "./admin-api";

/**
 * API client for the mobile-admin expenses surface. The web has
 * three screens (list, edit, analytics); on mobile we collapse list
 * + create + edit + delete into one flow, with a separate analytics
 * screen reachable from the same tab.
 */

export type ExpenseOptionField =
  | "PAYMENT_TYPE"
  | "DONE_BY"
  | "VENDOR"
  | "SPENT_TYPE"
  | "TO_NAME";

export interface AdminExpense {
  id: string;
  date: string;
  description: string;
  amount: number;
  paymentType: string;
  doneBy: string;
  toName: string;
  vendor: string;
  spentType: string;
  note: string | null;
  createdByAdminId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminExpenseDetail extends AdminExpense {
  editHistory: Array<{
    id: string;
    expenseId: string;
    adminId: string | null;
    adminUsername: string | null;
    editType: string;
    changes: unknown;
    note: string | null;
    createdAt: string;
  }>;
}

export interface AdminExpenseList {
  rows: AdminExpense[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  totalAmount: number;
}

export interface AdminExpenseAnalytics {
  totalAmount: number;
  totalCount: number;
  monthlySeries: { month: string; amount: number }[];
  bySpentType: { label: string; amount: number; count: number }[];
  byDoneBy: { label: string; amount: number; count: number }[];
  byPaymentType: { label: string; amount: number; count: number }[];
  byVendor: { label: string; amount: number; count: number }[];
  byToName: { label: string; amount: number; count: number }[];
}

export interface AdminExpenseInput {
  date: string;
  description: string;
  amount: number;
  paymentType: string;
  doneBy: string;
  toName: string;
  vendor: string;
  spentType: string;
  note?: string | null;
}

export const adminExpensesApi = {
  list(
    filters: {
      from?: string;
      to?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<AdminExpenseList> {
    const sp = new URLSearchParams();
    if (filters.from) sp.set("from", filters.from);
    if (filters.to) sp.set("to", filters.to);
    if (filters.search) sp.set("search", filters.search);
    if (filters.page) sp.set("page", String(filters.page));
    if (filters.pageSize) sp.set("pageSize", String(filters.pageSize));
    const qs = sp.toString();
    return request(
      `/api/mobile/admin/expenses${qs ? `?${qs}` : ""}`,
      { method: "GET" },
    );
  },

  detail(id: string): Promise<{ expense: AdminExpenseDetail }> {
    return request(`/api/mobile/admin/expenses/${id}`, { method: "GET" });
  },

  create(body: AdminExpenseInput): Promise<{ ok: true; id: string }> {
    return request("/api/mobile/admin/expenses", {
      method: "POST",
      body,
    });
  },

  update(
    id: string,
    body: AdminExpenseInput & { editNote?: string },
  ): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/expenses/${id}`, {
      method: "PATCH",
      body,
    });
  },

  remove(id: string): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/expenses/${id}`, {
      method: "DELETE",
    });
  },

  options(): Promise<{
    options: Record<ExpenseOptionField, string[]>;
  }> {
    return request("/api/mobile/admin/expenses/options", { method: "GET" });
  },

  analytics(filters: {
    from?: string;
    to?: string;
  } = {}): Promise<AdminExpenseAnalytics> {
    const sp = new URLSearchParams();
    if (filters.from) sp.set("from", filters.from);
    if (filters.to) sp.set("to", filters.to);
    const qs = sp.toString();
    return request(
      `/api/mobile/admin/expenses/analytics${qs ? `?${qs}` : ""}`,
      { method: "GET" },
    );
  },
};
