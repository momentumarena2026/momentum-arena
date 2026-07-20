import Link from "next/link";
import {
  BarChart3,
  Sliders,
  IndianRupee,
  TrendingDown,
  Receipt,
} from "lucide-react";
import {
  listExpenses,
  listActiveExpenseOptionsByField,
} from "@/actions/admin-expenses";
import { formatExpenseAmount } from "@/lib/expenses";
import { ExpenseFilters } from "../expenses/expense-filters";
import { RunningExpenseTable } from "./running-expense-table";
import { NewRunningExpenseButton } from "./new-running-expense-button";

// Admin list page for RUNNING expenses — a structural clone of the
// GENERAL expenses list, but the table groups rows by calendar month
// with collapsible sections. Filters live in the URL search params so
// the state is shareable and survives full-page navigation.
export default async function AdminRunningExpensesPage({
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
      module: "RUNNING",
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
    listActiveExpenseOptionsByField("RUNNING"),
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
    return `/admin/running-expenses${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Running Expenses</h1>
          <p className="mt-1 text-zinc-400">
            Recurring operational spend, grouped by month.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/running-expenses/analytics"
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:border-zinc-700"
          >
            <BarChart3 className="h-4 w-4" />
            Analytics
          </Link>
          <Link
            href="/admin/running-expenses/config"
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:border-zinc-700"
          >
            <Sliders className="h-4 w-4" />
            Dropdowns
          </Link>
          <NewRunningExpenseButton options={options} />
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
        basePath="/admin/running-expenses"
        showVendor={false}
      />

      {/* Table — month-collapsible */}
      <RunningExpenseTable
        rows={list.rows.map((r) => ({
          id: r.id,
          date: r.date.toISOString(),
          description: r.description,
          note: r.note,
          spentType: r.spentType,
          toName: r.toName,
          paymentType: r.paymentType,
          doneBy: r.doneBy,
          amount: r.amount,
        }))}
        basePath="/admin/running-expenses"
      />

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
