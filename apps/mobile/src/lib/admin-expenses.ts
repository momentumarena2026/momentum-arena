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

/**
 * Expense module. GENERAL is the original day-to-day expense log;
 * RUNNING is the month-wise recurring-costs ledger (rent, salaries,
 * utilities). Every read/write is scoped server-side by this flag —
 * omitting it everywhere keeps the legacy GENERAL behavior, so all
 * pre-existing callers are unchanged.
 */
export type ExpenseModule = "GENERAL" | "RUNNING";

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
      module?: ExpenseModule;
    } = {},
  ): Promise<AdminExpenseList> {
    const sp = new URLSearchParams();
    if (filters.from) sp.set("from", filters.from);
    if (filters.to) sp.set("to", filters.to);
    if (filters.search) sp.set("search", filters.search);
    if (filters.page) sp.set("page", String(filters.page));
    if (filters.pageSize) sp.set("pageSize", String(filters.pageSize));
    if (filters.module) sp.set("module", filters.module);
    const qs = sp.toString();
    return request(
      `/api/mobile/admin/expenses${qs ? `?${qs}` : ""}`,
      { method: "GET" },
    );
  },

  detail(id: string): Promise<{ expense: AdminExpenseDetail }> {
    return request(`/api/mobile/admin/expenses/${id}`, { method: "GET" });
  },

  create(
    body: AdminExpenseInput & { module?: ExpenseModule },
  ): Promise<{ ok: true; id: string }> {
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

  options(module?: ExpenseModule): Promise<{
    options: Record<ExpenseOptionField, string[]>;
  }> {
    const qs = module ? `?module=${module}` : "";
    return request(`/api/mobile/admin/expenses/options${qs}`, {
      method: "GET",
    });
  },

  analytics(filters: {
    from?: string;
    to?: string;
    module?: ExpenseModule;
  } = {}): Promise<AdminExpenseAnalytics> {
    const sp = new URLSearchParams();
    if (filters.from) sp.set("from", filters.from);
    if (filters.to) sp.set("to", filters.to);
    if (filters.module) sp.set("module", filters.module);
    const qs = sp.toString();
    return request(
      `/api/mobile/admin/expenses/analytics${qs ? `?${qs}` : ""}`,
      { method: "GET" },
    );
  },
};
