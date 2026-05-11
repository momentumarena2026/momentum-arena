"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, Sparkles } from "lucide-react";
import {
  adminBulkGrantPoints,
  searchUsersForRewards,
  type AdminUserBalanceRow,
} from "@/actions/admin-rewards";

interface Props {
  initialUsers: AdminUserBalanceRow[];
}

export function DistributeForm({ initialUsers }: Props) {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUserBalanceRow[]>(initialUsers);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [points, setPoints] = useState<number>(100);
  const [reason, setReason] = useState<string>("");
  const [searching, startSearch] = useTransition();
  const [granting, startGrant] = useTransition();
  const [result, setResult] = useState<{
    granted: number;
    skipped: number;
    totalPointsAwarded: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allChecked =
    users.length > 0 && users.every((u) => selected.has(u.userId));

  function toggleAll() {
    if (allChecked) {
      setSelected(new Set());
    } else {
      setSelected(new Set(users.map((u) => u.userId)));
    }
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runSearch(q: string) {
    startSearch(async () => {
      const next = await searchUsersForRewards({ query: q, limit: 100 });
      setUsers(next);
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const ids = Array.from(selected);
    if (ids.length === 0) {
      setError("Pick at least one user.");
      return;
    }
    if (points <= 0) {
      setError("Points must be greater than zero.");
      return;
    }
    if (reason.trim().length < 3) {
      setError("Reason is required (≥ 3 characters).");
      return;
    }
    startGrant(async () => {
      try {
        const r = await adminBulkGrantPoints({
          userIds: ids,
          points,
          reason: reason.trim(),
        });
        setResult(r);
        // Keep the selection — admin may want to grant a different
        // tranche to the same set next.
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Grant failed");
      }
    });
  }

  const totalPreview = useMemo(
    () => selected.size * points,
    [selected.size, points],
  );

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Form fields */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-zinc-300">
              Points per user
            </span>
            <input
              type="number"
              min={1}
              value={points}
              onChange={(e) => setPoints(parseInt(e.target.value || "0", 10))}
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-zinc-300">Reason</span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Diwali bonus — Oct 2026 campaign"
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-zinc-400">
            <span className="font-semibold text-white">{selected.size}</span>{" "}
            selected ·{" "}
            <span className="font-semibold text-emerald-400">
              {totalPreview.toLocaleString("en-IN")}
            </span>{" "}
            total points will be awarded
          </p>
          <button
            type="submit"
            disabled={granting || selected.size === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
          >
            <Sparkles className="h-4 w-4" />
            {granting ? "Granting…" : "Grant points"}
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
        {result && !error && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
            Granted {result.granted} of {result.granted + result.skipped} users ·{" "}
            {result.totalPointsAwarded.toLocaleString("en-IN")} points awarded
          </div>
        )}
      </div>

      {/* Search + user table */}
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runSearch(query);
                }
              }}
              placeholder="Filter users by name, email, phone"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 pl-9 pr-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => runSearch(query)}
            disabled={searching}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 hover:border-zinc-600 disabled:opacity-60"
          >
            {searching ? "…" : "Search"}
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-800 text-sm">
            <thead className="bg-zinc-950/60 text-zinc-500">
              <tr>
                <th className="w-10 px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    className="h-4 w-4 accent-emerald-500"
                    aria-label="Select all visible users"
                  />
                </th>
                <th className="px-4 py-2 text-left font-semibold uppercase tracking-wider text-xs">
                  User
                </th>
                <th className="px-4 py-2 text-left font-semibold uppercase tracking-wider text-xs">
                  Phone
                </th>
                <th className="px-4 py-2 text-right font-semibold uppercase tracking-wider text-xs">
                  Balance
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {users.map((u) => (
                <tr
                  key={u.userId}
                  className={`cursor-pointer hover:bg-zinc-900/50 ${
                    selected.has(u.userId) ? "bg-emerald-500/5" : ""
                  }`}
                  onClick={() => toggleOne(u.userId)}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(u.userId)}
                      onChange={() => toggleOne(u.userId)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 accent-emerald-500"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <p className="font-medium text-white">{u.name ?? "—"}</p>
                    <p className="text-xs text-zinc-500">{u.email ?? ""}</p>
                  </td>
                  <td className="px-4 py-2 text-zinc-300">{u.phone ?? "—"}</td>
                  <td className="px-4 py-2 text-right">
                    <span className="font-semibold text-emerald-400">
                      {u.pointsAvailable.toLocaleString("en-IN")}
                    </span>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-sm text-zinc-500"
                  >
                    No users match this search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-zinc-500">
          Tip: rows scroll independently of the form above. "Select all" only
          applies to the currently visible search results.
        </p>
      </div>
    </form>
  );
}
