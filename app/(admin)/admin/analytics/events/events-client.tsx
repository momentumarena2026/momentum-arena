"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { listAnalyticsEvents, type EventRow, type EventsListResult } from "@/actions/admin-insights";

const CATEGORIES = [
  "BOOKING",
  "PAYMENT",
  "AUTH",
  "CAFE",
  "WAITLIST",
  "NAVIGATION",
  "ADMIN",
  "ERROR",
  "SYSTEM",
];

interface Props {
  initialPage: EventsListResult;
  initialFilters: {
    name?: string;
    category?: string;
    userId?: string;
    sessionId?: string;
  };
  eventNames: string[];
}

export function EventsClient({ initialPage, initialFilters, eventNames }: Props) {
  const router = useRouter();
  const [filters, setFilters] = useState(initialFilters);
  const [rows, setRows] = useState<EventRow[]>(initialPage.rows);
  const [hasMore, setHasMore] = useState(initialPage.hasMore);
  const [nextCursor, setNextCursor] = useState<string | null>(initialPage.nextCursor);
  const [pending, startTransition] = useTransition();

  function applyFilters(next: typeof filters) {
    setFilters(next);
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, v);
    router.push(`/admin/analytics/events?${params.toString()}`);
  }

  function loadMore() {
    if (!nextCursor) return;
    startTransition(async () => {
      const more = await listAnalyticsEvents({
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
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <FilterField label="Event name">
          <select
            value={filters.name ?? ""}
            onChange={(e) => applyFilters({ ...filters, name: e.target.value || undefined })}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
          >
            <option value="">— any —</option>
            {eventNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Category">
          <select
            value={filters.category ?? ""}
            onChange={(e) => applyFilters({ ...filters, category: e.target.value || undefined })}
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
        <FilterField label="User ID">
          <input
            value={filters.userId ?? ""}
            onChange={(e) => setFilters({ ...filters, userId: e.target.value || undefined })}
            onBlur={() => applyFilters(filters)}
            placeholder="cuid…"
            className="w-48 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
          />
        </FilterField>
        <FilterField label="Session ID">
          <input
            value={filters.sessionId ?? ""}
            onChange={(e) => setFilters({ ...filters, sessionId: e.target.value || undefined })}
            onBlur={() => applyFilters(filters)}
            placeholder="cuid…"
            className="w-48 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
          />
        </FilterField>
        {(filters.name || filters.category || filters.userId || filters.sessionId) && (
          <button
            onClick={() => applyFilters({})}
            className="flex items-center gap-1 rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>

      {/* Event list */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40">
        {rows.length === 0 ? (
          <div className="py-12 text-center">
            <Search className="mx-auto h-8 w-8 text-zinc-600" />
            <p className="mt-3 text-sm text-zinc-500">
              No events match these filters.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800/60">
            {rows.map((r) => (
              <EventListItem key={r.id} row={r} setFilters={(f) => applyFilters(f)} />
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

function EventListItem({
  row,
  setFilters,
}: {
  row: EventRow;
  setFilters: (
    f: { name?: string; category?: string; userId?: string; sessionId?: string },
  ) => void;
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
  return (
    <li>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-zinc-800/40"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
        )}
        <span className="font-mono text-xs text-zinc-500" style={{ minWidth: 110 }}>
          {ts}
        </span>
        <code className="text-sm font-medium text-white">{row.name}</code>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
          {row.category}
        </span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
          {row.platform}
        </span>
        {row.userName && (
          <span className="ml-auto text-xs text-zinc-400">
            {row.userName}{row.userPhone ? ` · ${row.userPhone}` : ""}
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
                Filter by user: <code>{row.userId.slice(0, 12)}…</code>
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setFilters({ sessionId: row.sessionId });
              }}
              className="rounded bg-zinc-800 px-2 py-1 text-zinc-300 hover:bg-zinc-700"
            >
              Filter by session: <code>{row.sessionId.slice(0, 12)}…</code>
            </button>
          </div>
          <pre className="overflow-x-auto rounded bg-zinc-900 p-3 text-xs text-zinc-300">
            {JSON.stringify(row.properties, null, 2)}
          </pre>
          {row.pageUrl && (
            <p className="mt-2 truncate text-xs text-zinc-500">{row.pageUrl}</p>
          )}
        </div>
      )}
    </li>
  );
}
