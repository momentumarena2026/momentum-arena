"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { CollectionsDay } from "@/actions/admin-collections";

/**
 * The day-by-day collections table, with each day expandable into where
 * the money came from.
 *
 * "₹1,000 cash yesterday" is only useful if you can see it was ₹700 off
 * the turf and ₹300 over the cafe counter — that is the difference
 * between a number and something you can check a till against.
 *
 * The per-source rows come from the server already summed, not added up
 * here, so an expanded row cannot disagree with the day total above it.
 */
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function dayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function CollectionsDayTable({
  days,
  totals,
  showUnattributed,
}: {
  days: CollectionsDay[];
  totals: { cash: number; online: number; unattributed: number; total: number };
  showUnattributed: boolean;
}) {
  // Sparse: a day absent here is collapsed. Starting everything closed
  // keeps a month readable; the day being checked is one tap away.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const cols = showUnattributed ? 5 : 4;

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full min-w-[34rem] text-sm">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/60 text-[11px] uppercase tracking-wide text-zinc-500">
            <th scope="col" className="px-4 py-2 text-left font-medium">
              Day
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Cash
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Online
            </th>
            {showUnattributed ? (
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Unattributed
              </th>
            ) : null}
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Total
            </th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {days.length === 0 ? (
            <tr>
              <td
                colSpan={cols}
                className="px-4 py-6 text-center text-sm text-zinc-500"
              >
                Nothing was collected in this range.
              </td>
            </tr>
          ) : (
            days.map((d) => {
              const isOpen = !!open[d.date];
              return [
                <tr
                  key={d.date}
                  className="border-b border-zinc-800/60 last:border-0"
                >
                  <th scope="row" className="px-2 py-1 text-left font-medium">
                    <button
                      type="button"
                      onClick={() =>
                        setOpen((o) => ({ ...o, [d.date]: !o[d.date] }))
                      }
                      aria-expanded={isOpen}
                      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-zinc-300 transition-colors hover:bg-zinc-800/60"
                    >
                      {isOpen ? (
                        <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
                      )}
                      <span className="whitespace-nowrap">
                        {dayLabel(d.date)}
                      </span>
                      <span className="text-[10px] font-normal text-zinc-600">
                        {d.sources.length}{" "}
                        {d.sources.length === 1 ? "source" : "sources"}
                      </span>
                    </button>
                  </th>
                  <td
                    className={`px-4 py-2 text-right ${d.cash > 0 ? "text-amber-300" : "text-zinc-700"}`}
                  >
                    {d.cash > 0 ? inr(d.cash) : "—"}
                  </td>
                  <td
                    className={`px-4 py-2 text-right ${d.online > 0 ? "text-sky-300" : "text-zinc-700"}`}
                  >
                    {d.online > 0 ? inr(d.online) : "—"}
                  </td>
                  {showUnattributed ? (
                    <td
                      className={`px-4 py-2 text-right ${d.unattributed > 0 ? "text-amber-200/70" : "text-zinc-700"}`}
                    >
                      {d.unattributed > 0 ? inr(d.unattributed) : "—"}
                    </td>
                  ) : null}
                  <td className="px-4 py-2 text-right font-semibold text-white">
                    {inr(d.total)}
                  </td>
                </tr>,

                isOpen ? (
                  <tr key={`${d.date}-sources`} className="bg-zinc-950/50">
                    <td colSpan={cols} className="px-4 py-2">
                      <table className="w-full text-xs tabular-nums">
                        <tbody>
                          {d.sources.map((s) => (
                            <tr key={s.source}>
                              <th
                                scope="row"
                                className="py-1 pl-6 text-left font-normal text-zinc-400"
                              >
                                {s.source}
                              </th>
                              <td className="py-1 text-right text-amber-300/80">
                                {s.cash > 0 ? inr(s.cash) : "—"}
                              </td>
                              <td className="py-1 text-right text-sky-300/80">
                                {s.online > 0 ? inr(s.online) : "—"}
                              </td>
                              {showUnattributed ? (
                                <td className="py-1 text-right text-amber-200/60">
                                  {s.unattributed > 0
                                    ? inr(s.unattributed)
                                    : "—"}
                                </td>
                              ) : null}
                              <td className="py-1 pr-0 text-right text-zinc-300">
                                {inr(s.total)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                ) : null,
              ];
            })
          )}
        </tbody>
        {days.length > 0 ? (
          <tfoot>
            <tr className="border-t border-zinc-700 bg-zinc-900/60 tabular-nums">
              <th scope="row" className="px-4 py-2 text-left text-zinc-300">
                Range total
              </th>
              <td className="px-4 py-2 text-right font-semibold text-amber-300">
                {inr(totals.cash)}
              </td>
              <td className="px-4 py-2 text-right font-semibold text-sky-300">
                {inr(totals.online)}
              </td>
              {showUnattributed ? (
                <td className="px-4 py-2 text-right font-semibold text-amber-200/70">
                  {inr(totals.unattributed)}
                </td>
              ) : null}
              <td className="px-4 py-2 text-right font-bold text-white">
                {inr(totals.total)}
              </td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
