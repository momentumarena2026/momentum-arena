import Link from "next/link";
import {
  Plus,
  BarChart3,
  Sliders,
  IndianRupee,
  TrendingDown,
  Calendar,
  Receipt,
} from "lucide-react";
import {
  listExpenses,
  listActiveExpenseOptionsByField,
} from "@/actions/admin-expenses";
import { formatExpenseAmount, formatExpenseDate } from "@/lib/expenses";
import { ExpenseFilters } from "./expense-filters";

// Admin list page for expenses. Server-rendered with filters in the
// URL search params so the filter state is shareable and survives
// full-page navigation. Pagination is also URL-driven.
export default async function AdminExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    spentType?: string;
    doneBy?: string;
    paymentType?: string;
    vendor?: string;
    search?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const page = parseInt(params.page || "1", 10) || 1;

  const [list, options] = await Promise.all([
    listExpenses({
      from: params.from,
      to: params.to,
      spentType: params.spentType,
      doneBy: params.doneBy,
      paymentType: params.paymentType,
      vendor: params.vendor,
      search: params.search,
      page,
      pageSize: 50,
    }),
    listActiveExpenseOptionsByField(),
  ]);

  function buildUrl(overrides: Record<string, string | undefined>) {
    const base: Record<string, string> = {
      from: params.from || "",
      to: params.to || "",
      spentType: params.spentType || "",
      doneBy: params.doneBy || "",
      paymentType: params.paymentType || "",
      vendor: params.vendor || "",
      search: params.search || "",
      page: String(page),
    };
    const merged: Record<string, string | undefined> = { ...base, ...overrides };
    const qs = Object.entries(merged)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
      .join("&");
    return `/admin/expenses${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Expenses</h1>
          <p className="mt-1 text-zinc-400">
            Track every rupee out — replaces the Playing Zone Mathura spend sheet.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/expenses/analytics"
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:border-zinc-700"
          >
            <BarChart3 className="h-4 w-4" />
            Analytics
          </Link>
          <Link
            href="/admin/expenses/config"
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:border-zinc-700"
          >
            <Sliders className="h-4 w-4" />
            Dropdowns
          </Link>
          <Link
            href="/admin/expenses/new"
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            <Plus className="h-4 w-4" />
            New Expense
          </Link>
        </div>
      </div>

      {/* Summary card */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 uppercase tracking-wide">
            <IndianRupee className="h-3.5 w-3.5" />
            Filtered Total
          </div>
          <div className="mt-1 text-xl font-semibold text-white">
            {formatExpenseAmount(list.totalAmount)}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 uppercase tracking-wide">
            <Receipt className="h-3.5 w-3.5" />
            Entries
          </div>
          <div className="mt-1 text-xl font-semibold text-white">
            {list.total.toLocaleString("en-IN")}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 uppercase tracking-wide">
            <TrendingDown className="h-3.5 w-3.5" />
            Avg / Entry
          </div>
          <div className="mt-1 text-xl font-semibold text-white">
            {list.total > 0
              ? formatExpenseAmount(Math.round(list.totalAmount / list.total))
              : "—"}
          </div>
        </div>
      </div>

      {/* Filters */}
      <ExpenseFilters
        initial={{
          from: params.from || "",
          to: params.to || "",
          spentType: params.spentType || "",
          doneBy: params.doneBy || "",
          paymentType: params.paymentType || "",
          vendor: params.vendor || "",
          search: params.search || "",
        }}
        options={options}
      />

      {/* Table */}
      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-left text-xs uppercase tracking-wide text-zinc-400">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">Spent Type</th>
                <th className="px-4 py-3 font-medium">To</th>
                <th className="px-4 py-3 font-medium">Vendor</th>
                <th className="px-4 py-3 font-medium">Payment</th>
                <th className="px-4 py-3 font-medium">Done By</th>
                <th className="px-4 py-3 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 bg-zinc-950">
              {list.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center text-zinc-500"
                  >
                    No expenses match these filters.
                  </td>
                </tr>
              ) : (
                list.rows.map((r) => (
                  <tr
                    key={r.id}
                    className="hover:bg-zinc-900/50"
                  >
                    <td className="px-4 py-3 text-zinc-300 whitespace-nowrap">
                      <Link
                        href={`/admin/expenses/${r.id}/edit`}
                        className="inline-flex items-center gap-1.5 text-zinc-200 hover:text-emerald-400"
                      >
                        <Calendar className="h-3.5 w-3.5 text-zinc-500" />
                        {formatExpenseDate(r.date)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-zinc-200 max-w-xs">
                      <Link
                        href={`/admin/expenses/${r.id}/edit`}
                        className="hover:text-emerald-400"
                      >
                        {r.description}
                        {r.note ? (
                          <span className="block text-xs text-zinc-500 truncate">
                            {r.note}
                          </span>
                        ) : null}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-md bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                        {r.spentType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">
                      {r.toName}
                    </td>
                    <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">
                      {r.vendor}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${
                          r.paymentType === "Cash"
                            ? "bg-amber-500/15 text-amber-300"
                            : "bg-blue-500/15 text-blue-300"
                        }`}
                      >
                        {r.paymentType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">
                      {r.doneBy}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-white whitespace-nowrap">
                      {formatExpenseAmount(r.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {list.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-zinc-400">
          <div>
            Page {list.page} of {list.totalPages}
          </div>
          <div className="flex items-center gap-2">
            {list.page > 1 && (
              <Link
                href={buildUrl({ page: String(list.page - 1) })}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 hover:border-zinc-700"
              >
                Previous
              </Link>
            )}
            {list.page < list.totalPages && (
              <Link
                href={buildUrl({ page: String(list.page + 1) })}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 hover:border-zinc-700"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
