"use client";

import Link from "next/link";
import { useState } from "react";
import { Calendar, ChevronDown, ChevronRight } from "lucide-react";
import { formatExpenseAmount, formatExpenseDate } from "@/lib/expenses";

// Month-collapsible table for the Running Expenses list. Same cell
// styling as the GENERAL expenses table (minus the Vendor column —
// RUNNING rows have no vendor), but the fetched page
// of rows is grouped client-side by calendar month of `date`. Each
// month gets a clickable header row (label + entry count + total +
// chevron); the most recent month starts expanded, older months start
// collapsed.

export interface RunningExpenseRow {
  id: string;
  /** ISO date string (UTC) — the DATE column serialized for the client. */
  date: string;
  description: string;
  note: string | null;
  spentType: string;
  toName: string;
  paymentType: string;
  doneBy: string;
  amount: number;
}

interface Props {
  rows: RunningExpenseRow[];
  basePath?: string;
}

function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7); // YYYY-MM
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return d.toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function RunningExpenseTable({
  rows,
  basePath = "/admin/running-expenses",
}: Props) {
  // Rows arrive sorted date desc from the server, so grouping in order
  // yields groups from most recent to oldest.
  const groups: { key: string; rows: RunningExpenseRow[]; total: number }[] = [];
  for (const r of rows) {
    const key = monthKey(r.date);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.rows.push(r);
      last.total += r.amount;
    } else {
      groups.push({ key, rows: [r], total: r.amount });
    }
  }
  const mostRecentKey = groups[0]?.key;

  // User toggles are stored as overrides on top of the default state
  // (most recent month open, rest closed). This keeps behavior sane
  // when the row set changes under us (filter / page navigation)
  // without needing reset effects.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const isExpanded = (key: string) => overrides[key] ?? key === mostRecentKey;
  const toggle = (key: string) =>
    setOverrides((prev) => ({ ...prev, [key]: !isExpanded(key) }));

  return (
    <div className="rounded-xl border border-zinc-800 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase tracking-wide text-zinc-400">
            <tr>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Description</th>
              <th className="px-4 py-3 font-medium">Spent Type</th>
              <th className="px-4 py-3 font-medium">To</th>
              <th className="px-4 py-3 font-medium">Payment</th>
              <th className="px-4 py-3 font-medium">Done By</th>
              <th className="px-4 py-3 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800 bg-zinc-950">
            {groups.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-zinc-500"
                >
                  No expenses match these filters.
                </td>
              </tr>
            ) : (
              groups.map((g) => {
                const expanded = isExpanded(g.key);
                return [
                  <tr
                    key={`month-${g.key}`}
                    onClick={() => toggle(g.key)}
                    className="cursor-pointer bg-zinc-900/70 hover:bg-zinc-900 select-none"
                  >
                    <td colSpan={6} className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-2 text-sm font-medium text-zinc-200">
                        {expanded ? (
                          <ChevronDown className="h-4 w-4 text-zinc-500" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-zinc-500" />
                        )}
                        {monthLabel(g.key)}
                        <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                          {g.rows.length}{" "}
                          {g.rows.length === 1 ? "entry" : "entries"}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-white whitespace-nowrap">
                      {formatExpenseAmount(g.total)}
                    </td>
                  </tr>,
                  ...(expanded
                    ? g.rows.map((r) => (
                        <tr key={r.id} className="hover:bg-zinc-900/50">
                          <td className="px-4 py-3 text-zinc-300 whitespace-nowrap">
                            <Link
                              href={`${basePath}/${r.id}/edit`}
                              className="inline-flex items-center gap-1.5 text-zinc-200 hover:text-emerald-400"
                            >
                              <Calendar className="h-3.5 w-3.5 text-zinc-500" />
                              {formatExpenseDate(r.date)}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-zinc-200 max-w-xs">
                            <Link
                              href={`${basePath}/${r.id}/edit`}
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
                    : []),
                ];
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
