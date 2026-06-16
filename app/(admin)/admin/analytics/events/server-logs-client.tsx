"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Loader2, Search, X } from "lucide-react";
import { Sport } from "@prisma/client";
import {
  AnalyticsCategory,
  extractPaymentMethodFromMetadata,
  extractSportFromMetadata,
  formatPaymentMethodLabel,
  getServerActionLabel,
  parseAnalyticsCategory,
} from "@/lib/server-log";
import { searchUsersForPicker, listUsersForPicker } from "@/actions/admin-user-groups";
import {
  listServerActionLogs,
  type ServerLogRow,
  type ServerLogsListResult,
} from "@/actions/admin-insights";

const CATEGORIES = Object.values(AnalyticsCategory);

type ServerLogFilters = {
  action?: string;
  category?: AnalyticsCategory;
  userId?: string;
  outcome?: string;
};

type PickerUser = {
  id: string;
  name: string | null;
  email?: string | null;
  phone: string | null;
};

interface Props {
  initialPage: ServerLogsListResult;
  initialFilters: ServerLogFilters;
  actionNames: string[];
  selectedUser: PickerUser | null;
  defaultUsers: PickerUser[];
}

function formatUserLabel(user: PickerUser): string {
  const name = user.name?.trim() || "Unknown";
  const phone = user.phone?.trim();
  return phone ? `${name} · ${phone}` : name;
}

export function ServerLogsClient({
  initialPage,
  initialFilters,
  actionNames,
  selectedUser,
  defaultUsers,
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
          <SearchableListFilter
            value={filters.action}
            placeholder="Search actions…"
            emptyLabel="— any action —"
            options={actionNames}
            renderOption={(o) => {
              const label = getServerActionLabel(o);
              return label === o ? o : `${label} · ${o}`;
            }}
            matchOption={(o, q) => {
              const label = getServerActionLabel(o).toLowerCase();
              return (
                !q ||
                o.toLowerCase().includes(q) ||
                label.includes(q)
              );
            }}
            onChange={(action) => applyFilters({ ...filters, action })}
          />
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
          <UserSearchFilter
            value={filters.userId}
            selectedUser={selectedUser}
            defaultUsers={defaultUsers}
            onChange={(userId) => applyFilters({ ...filters, userId })}
          />
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

/** Static searchable list — one input, filtered results below. */
function SearchableListFilter({
  value,
  options,
  placeholder,
  emptyLabel,
  onChange,
  renderOption = (o) => o,
  matchOption = (o, q) => !q || o.toLowerCase().includes(q),
}: {
  value?: string;
  options: string[];
  placeholder: string;
  emptyLabel: string;
  onChange: (value: string | undefined) => void;
  renderOption?: (option: string) => string;
  matchOption?: (option: string, query: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value ?? "");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value ?? "");
  }, [value]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = options.filter((o) => matchOption(o, q));

  function pick(option: string | undefined) {
    onChange(option);
    setQuery(option ?? "");
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative min-w-[14rem]">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
        <input
          type="text"
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (!e.target.value.trim()) onChange(undefined);
          }}
          onFocus={() => setOpen(true)}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 py-2 pl-8 pr-8 text-sm text-white placeholder:text-zinc-600"
        />
        {query && (
          <button
            type="button"
            onClick={() => pick(undefined)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && (
        <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-zinc-700 bg-zinc-950 shadow-xl">
          <li>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(undefined);
              }}
              className="w-full px-3 py-2 text-left text-sm text-zinc-400 hover:bg-zinc-900"
            >
              {emptyLabel}
            </button>
          </li>
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-zinc-500">No matches</li>
          ) : (
            filtered.map((o) => (
              <li key={o}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(o);
                  }}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-zinc-900 ${
                    value === o ? "bg-zinc-900 text-emerald-400" : "text-white"
                  }`}
                >
                  {renderOption(o)}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/** Server-side user search across the full User table. */
function UserSearchFilter({
  value,
  selectedUser,
  defaultUsers,
  onChange,
}: {
  value?: string;
  selectedUser: PickerUser | null;
  defaultUsers: PickerUser[];
  onChange: (userId: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(
    selectedUser ? formatUserLabel(selectedUser) : "",
  );
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<PickerUser[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(selectedUser ? formatUserLabel(selectedUser) : "");
  }, [selectedUser]);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const rows =
        debounced.length >= 2
          ? await searchUsersForPicker(debounced, 30)
          : defaultUsers;
      if (cancelled) return;
      setResults(rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced, open, defaultUsers]);

  function pick(user: PickerUser | undefined) {
    onChange(user?.id);
    setQuery(user ? formatUserLabel(user) : "");
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative min-w-[14rem]">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
        <input
          type="text"
          value={query}
          placeholder="Search name, email, or phone…"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (!e.target.value.trim()) onChange(undefined);
          }}
          onFocus={() => setOpen(true)}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 py-2 pl-8 pr-8 text-sm text-white placeholder:text-zinc-600"
        />
        {query && (
          <button
            type="button"
            onClick={() => pick(undefined)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && (
        <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-zinc-700 bg-zinc-950 shadow-xl">
          <li>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(undefined);
              }}
              className="w-full px-3 py-2 text-left text-sm text-zinc-400 hover:bg-zinc-900"
            >
              — all users —
            </button>
          </li>
          {loading ? (
            <li className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-zinc-500">No users found</li>
          ) : (
            results.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(u);
                  }}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-zinc-900 ${
                    value === u.id ? "bg-zinc-900 text-emerald-400" : "text-white"
                  }`}
                >
                  <div>{formatUserLabel(u)}</div>
                  {u.email && (
                    <div className="text-xs text-zinc-500">{u.email}</div>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
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

const SPORT_BADGE_CLASS =
  "border-blue-500/25 bg-blue-500/10 text-blue-300";

function SportBadge({ sport }: { sport: Sport }) {
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${SPORT_BADGE_CLASS}`}
    >
      {sport}
    </span>
  );
}

const PAYMENT_METHOD_BADGE_CLASS: Record<string, string> = {
  online: "border-blue-500/25 bg-blue-500/10 text-blue-300",
  upi_qr: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  cash: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  UPI_QR: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  CASH: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  RAZORPAY: "border-blue-500/25 bg-blue-500/10 text-blue-300",
  PHONEPE: "border-purple-500/25 bg-purple-500/10 text-purple-300",
};

function PaymentMethodBadge({ method }: { method: string }) {
  const colorClass =
    PAYMENT_METHOD_BADGE_CLASS[method] ??
    "border-zinc-600 bg-zinc-800 text-zinc-300";

  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10px] font-medium tracking-wide ${colorClass}`}
    >
      {formatPaymentMethodLabel(method)}
    </span>
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
    hour12: true,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const outcomeClass =
    row.outcome === "success"
      ? "text-emerald-400 bg-emerald-500/10"
      : "text-red-400 bg-red-500/10";
  const label = getServerActionLabel(row.action);
  const sport = row.sport ?? extractSportFromMetadata(row.metadata);
  const paymentMethod = extractPaymentMethodFromMetadata(row.metadata);

  return (
    <li>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-zinc-800/40"
      >
        <span className="mt-0.5 shrink-0 text-zinc-500">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
        <span className="mt-0.5 shrink-0 font-mono text-xs text-zinc-500" style={{ minWidth: 110 }}>
          {ts}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="text-sm font-medium text-white">{label}</span>
            {sport && <SportBadge sport={sport} />}
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${outcomeClass}`}
            >
              {row.outcome === "success" ? "Success" : "Failed"}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {paymentMethod && <PaymentMethodBadge method={paymentMethod} />}
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
              {row.category}
            </span>
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
              {row.platform}
            </span>
          </div>
        </div>
        {(row.userName || row.userPhone) && (
          <span className="ml-auto shrink-0 text-right text-xs text-zinc-400">
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
                  : row.userId}
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
