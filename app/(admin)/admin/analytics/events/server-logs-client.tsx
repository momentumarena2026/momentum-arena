"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { AnalyticsCategory, parseAnalyticsCategory } from "@/lib/server-log";
import {
  listServerActionLogs,
  type ServerLogRow,
  type ServerLogUserOption,
  type ServerLogsListResult,
} from "@/actions/admin-insights";

const CATEGORIES = Object.values(AnalyticsCategory);

type ServerLogFilters = {
  action?: string;
  category?: AnalyticsCategory;
  userId?: string;
  outcome?: string;
};

interface Props {
  initialPage: ServerLogsListResult;
  initialFilters: ServerLogFilters;
  actionNames: string[];
  userOptions: ServerLogUserOption[];
}

function formatUserLabel(user: ServerLogUserOption): string {
  const name = user.name?.trim() || "Unknown";
  const phone = user.phone?.trim();
  return phone ? `${name} · ${phone}` : name;
}

export function ServerLogsClient({
  initialPage,
  initialFilters,
  actionNames,
  userOptions,
}: Props) {
  const router = useRouter();
  const [filters, setFilters] = useState(initialFilters);
  const [rows, setRows] = useState<ServerLogRow[]>(initialPage.rows);
  const [hasMore, setHasMore] = useState(initialPage.hasMore);
  const [nextCursor, setNextCursor] = useState<string | null>(
    initialPage.nextCursor,
  );
  const [pending, startTransition] = useTransition();

  function applyFilters(next: ServerLogFilters) {
    setFilters(next);
    const params = new URLSearchParams({ view: "server" });
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, v);
    router.push(`/admin/analytics/events?${params.toString()}`);
  }

  function loadMore() {
    if (!nextCursor) return;
    startTransition(async () => {
      const more = await listServerActionLogs({
        ...filters,
        before: nextCursor,
        limit: 100,
      });
      setRows((prev) => [...prev, ...more.rows]);
      setHasMore(more.hasMore);
      setNextCursor(more.nextCursor);
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <FilterField label="Action">
          <select
            value={filters.action ?? ""}
            onChange={(e) =>
              applyFilters({ ...filters, action: e.target.value || undefined })
            }
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
          >
            <option value="">— any —</option>
            {actionNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Category">
          <select
            value={filters.category ?? ""}
            onChange={(e) =>
              applyFilters({
                ...filters,
                category: parseAnalyticsCategory(e.target.value || undefined),
              })
            }
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
          >
            <option value="">— any —</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Outcome">
          <select
            value={filters.outcome ?? ""}
            onChange={(e) =>
              applyFilters({
                ...filters,
                outcome: e.target.value || undefined,
              })
            }
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
          >
            <option value="">— any —</option>
            <option value="success">success</option>
            <option value="error">error</option>
          </select>
        </FilterField>
        <FilterField label="User">
          <select
            value={filters.userId ?? ""}
            onChange={(e) =>
              applyFilters({
                ...filters,
                userId: e.target.value || undefined,
              })
            }
            className="min-w-[12rem] max-w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
          >
            <option value="">— all users —</option>
            {userOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {formatUserLabel(u)}
              </option>
            ))}
          </select>
        </FilterField>
        {(filters.action ||
          filters.category ||
          filters.userId ||
          filters.outcome) && (
          <button
            onClick={() => applyFilters({})}
            className="flex items-center gap-1 rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40">
        {rows.length === 0 ? (
          <div className="py-12 text-center">
            <Search className="mx-auto h-8 w-8 text-zinc-600" />
            <p className="mt-3 text-sm text-zinc-500">
              No server logs match these filters.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800/60">
            {rows.map((r) => (
              <ServerLogListItem
                key={r.id}
                row={r}
                setFilters={(f) => applyFilters(f)}
              />
            ))}
          </ul>
        )}
        {hasMore && (
          <div className="border-t border-zinc-800 p-4 text-center">
            <button
              onClick={loadMore}
              disabled={pending}
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              {pending ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function ServerLogListItem({
  row,
  setFilters,
}: {
  row: ServerLogRow;
  setFilters: (f: ServerLogFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const ts = new Date(row.occurredAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: false,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const outcomeClass =
    row.outcome === "success"
      ? "text-emerald-400 bg-emerald-500/10"
      : "text-red-400 bg-red-500/10";

  return (
    <li>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left hover:bg-zinc-800/40"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
        )}
        <span className="font-mono text-xs text-zinc-500" style={{ minWidth: 110 }}>
          {ts}
        </span>
        <code className="text-sm font-medium text-white">{row.action}</code>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${outcomeClass}`}
        >
          {row.outcome}
        </span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
          {row.category}
        </span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
          {row.platform}
        </span>
        {(row.userName || row.userPhone) && (
          <span className="ml-auto min-w-0 max-w-full truncate text-xs text-zinc-400 sm:max-w-[260px]">
            {row.userName ?? "Unknown"}
            {row.userPhone ? ` · ${row.userPhone}` : ""}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-zinc-800 bg-zinc-950 px-4 py-3">
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            {row.userId && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFilters({ userId: row.userId ?? undefined });
                }}
                className="rounded bg-zinc-800 px-2 py-1 text-zinc-300 hover:bg-zinc-700"
              >
                Filter by user:{" "}
                {row.userName || row.userPhone
                  ? `${row.userName ?? "Unknown"}${row.userPhone ? ` · ${row.userPhone}` : ""}`
                  : `${row.userId.slice(0, 12)}…`}
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setFilters({ action: row.action });
              }}
              className="rounded bg-zinc-800 px-2 py-1 text-zinc-300 hover:bg-zinc-700"
            >
              Filter by action
            </button>
          </div>
          {(row.path || row.method) && (
            <p className="mb-2 font-mono text-xs text-zinc-500">
              {row.method} {row.path}
            </p>
          )}
          {row.error && (
            <p className="mb-2 text-xs text-red-400">{row.error}</p>
          )}
          <pre className="overflow-x-auto rounded bg-zinc-900 p-3 text-xs text-zinc-300">
            {JSON.stringify(row.metadata, null, 2)}
          </pre>
        </div>
      )}
    </li>
  );
}

export function EventsViewTabs({ view }: { view: "client" | "server" }) {
  const base = "rounded-md px-3 py-1.5 text-sm transition-colors";
  const active = "bg-zinc-800 text-white";
  const inactive = "text-zinc-400 hover:text-white";

  return (
    <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900/40 p-1 w-fit">
      <Link
        href="/admin/analytics/events"
        className={`${base} ${view === "client" ? active : inactive}`}
      >
        Client events
      </Link>
      <Link
        href="/admin/analytics/events?view=server"
        className={`${base} ${view === "server" ? active : inactive}`}
      >
        Server logs
      </Link>
    </div>
  );
}
