"use client";

import { useEffect, useState, useTransition } from "react";
import { Search, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import {
  getBookingBotLogs,
  getBookingBotPerformance,
  type BotLogRow,
  type BotPerformance,
} from "@/actions/admin-booking-bot";

type Filter = "all" | "model" | "rules" | "rejected" | "confirmed";

const FILTERS: { key: Filter; label: string; hint: string }[] = [
  { key: "all", label: "Everything", hint: "every message typed into Quick book" },
  { key: "rules", label: "Rules only", hint: "answered with no model call — free and instant" },
  { key: "model", label: "Asked the model", hint: "the rules could not read it alone" },
  { key: "rejected", label: "Model refused", hint: "the answer failed validation and was discarded" },
  { key: "confirmed", label: "Became bookings", hint: "the customer went through with it" },
];

/**
 * The event log.
 *
 * Every message, what our rules made of it, what the model made of it,
 * and which reading actually shipped — side by side, because that
 * comparison is the only way to tell whether a wrong answer came from
 * our own parser or from the model, and the two need completely
 * different fixes.
 *
 * Loaded on the client rather than server-rendered per page so that
 * filtering and paging do not reload the settings and review sections
 * above it, which is where somebody usually is when they reach for this.
 */
export function LogsPanel() {
  const [rows, setRows] = useState<BotLogRow[]>([]);
  const [perf, setPerf] = useState<BotPerformance | null>(null);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const res = await getBookingBotLogs({ page, filter, search: applied });
      setRows(res.rows);
      setTotal(res.total);
      setPageSize(res.pageSize);
    });
  }, [page, filter, applied]);

  useEffect(() => {
    startTransition(async () => setPerf(await getBookingBotPerformance()));
  }, []);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      {/* ── Performance ──────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">Performance</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Median model reply" value={ms(perf?.p50)} hint="half of calls are faster" />
          <Metric
            label="Slow model reply"
            value={ms(perf?.p95)}
            hint="1 in 20 calls is slower than this"
          />
          <Metric label="Slowest seen" value={ms(perf?.slowest)} hint="calls are abandoned at 2500 ms" />
          <Metric
            label="Answers refused"
            value={String(perf?.rejections.reduce((a, r) => a + r.count, 0) ?? 0)}
            hint="never reached a customer"
          />
        </div>

        {perf && perf.rejections.length > 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              Why answers were refused
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {perf.rejections.map((r) => (
                <li
                  key={r.reason}
                  className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300"
                >
                  <span className="font-mono">{r.reason}</span>{" "}
                  <span className="text-zinc-500">×{r.count}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {perf && perf.daily.length > 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              Last 14 days — total messages, and how many needed the model
            </p>
            <div className="mt-3 flex items-end gap-1.5">
              {perf.daily.map((d) => {
                const max = Math.max(...perf.daily.map((x) => x.total), 1);
                return (
                  <div key={d.day} className="flex-1" title={`${d.day}: ${d.total} messages, ${d.viaModel} needed the model`}>
                    <div className="relative h-20 w-full">
                      <div
                        className="absolute bottom-0 w-full rounded-sm bg-emerald-500/30"
                        style={{ height: `${(d.total / max) * 100}%` }}
                      />
                      <div
                        className="absolute bottom-0 w-full rounded-sm bg-emerald-500"
                        style={{ height: `${(d.viaModel / max) * 100}%` }}
                      />
                    </div>
                    <p className="mt-1 truncate text-center text-[10px] text-zinc-600">
                      {d.day.slice(8)}
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              Solid = needed the model. Faded = answered by our rules alone. The
              faded share is what should grow.
            </p>
          </div>
        ) : null}
      </section>

      {/* ── Events ───────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">
            Every message <span className="text-zinc-500">({total})</span>
          </h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-zinc-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setPage(0);
                    setApplied(search);
                  }
                }}
                placeholder="Search messages…"
                className="w-56 rounded border border-zinc-700 bg-zinc-950 py-1.5 pl-8 pr-2 text-sm text-white outline-none focus:border-emerald-500/60"
              />
            </div>
            <button
              onClick={() => {
                setPage(0);
                setApplied(search);
              }}
              className="rounded border border-zinc-700 p-1.5 text-zinc-400 hover:bg-zinc-800"
              title="Refresh"
            >
              <RefreshCw size={14} className={pending ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              title={f.hint}
              onClick={() => {
                setFilter(f.key);
                setPage(0);
              }}
              className={`rounded-full border px-3 py-1 text-xs ${
                filter === f.key
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                  : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-zinc-900/60 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Message</th>
                <th className="px-3 py-2 font-medium">Our rules</th>
                <th className="px-3 py-2 font-medium">The model</th>
                <th className="px-3 py-2 font-medium">Shown</th>
                <th className="px-3 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-zinc-500">
                    {pending ? "Loading…" : "Nothing here."}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-zinc-500">
                      {new Date(r.createdAt).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="max-w-[260px] px-3 py-2 text-zinc-300">“{r.text}”</td>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-400">{r.rules}</td>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-500">
                      {r.route === "" ? (
                        <span className="text-zinc-700">not asked</span>
                      ) : (
                        r.model
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-emerald-300">{r.final}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {r.route === "" ? (
                          <Tag tone="good">rules only</Tag>
                        ) : (
                          <Tag tone="info">{r.route}</Tag>
                        )}
                        {r.overruled ? <Tag tone="warn">model overruled</Tag> : null}
                        {r.rejected ? <Tag tone="bad">{r.rejected}</Tag> : null}
                        {r.confirmed ? <Tag tone="good">booked</Tag> : null}
                        {r.latencyMs ? (
                          <Tag tone="plain">{r.latencyMs} ms</Tag>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-sm text-zinc-500">
          <span>
            Page {page + 1} of {pages}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page === 0 || pending}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="inline-flex items-center gap-1 rounded border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
            >
              <ChevronLeft size={14} /> Newer
            </button>
            <button
              disabled={page + 1 >= pages || pending}
              onClick={() => setPage((p) => p + 1)}
              className="inline-flex items-center gap-1 rounded border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
            >
              Older <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function ms(v: number | null | undefined): string {
  return v == null ? "—" : `${v} ms`;
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{hint}</p>
    </div>
  );
}

function Tag({
  tone,
  children,
}: {
  tone: "good" | "warn" | "bad" | "info" | "plain";
  children: React.ReactNode;
}) {
  const cls = {
    good: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    warn: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    bad: "border-red-500/40 bg-red-500/10 text-red-300",
    info: "border-sky-500/40 bg-sky-500/10 text-sky-300",
    plain: "border-zinc-700 text-zinc-500",
  }[tone];
  return (
    <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] ${cls}`}>
      {children}
    </span>
  );
}
