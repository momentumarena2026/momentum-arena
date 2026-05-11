"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Search, Sparkles, UserSearch } from "lucide-react";
import {
  searchUsersForRewards,
  type AdminUserBalanceRow,
} from "@/actions/admin-rewards";

interface Props {
  initial: AdminUserBalanceRow[];
}

export function RewardsUsersPanel({ initial }: Props) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<AdminUserBalanceRow[]>(initial);
  const [pending, startTransition] = useTransition();

  function runSearch(q: string) {
    startTransition(async () => {
      const next = await searchUsersForRewards({ query: q, limit: 50 });
      setRows(next);
    });
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(query);
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, or phone"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 pl-9 pr-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
        >
          {pending ? "…" : "Search"}
        </button>
        <Link
          href="/admin/rewards/distribute"
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-600"
        >
          <Sparkles className="h-4 w-4 text-emerald-400" />
          Bulk grant
        </Link>
      </form>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 py-12">
          <UserSearch className="h-6 w-6 text-zinc-600" />
          <p className="mt-2 text-sm text-zinc-400">No users match this search</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-800 text-sm">
            <thead className="bg-zinc-950/60 text-zinc-500">
              <tr>
                <Th>User</Th>
                <Th>Phone</Th>
                <Th align="right">Available</Th>
                <Th align="right">Earned</Th>
                <Th align="right">Redeemed</Th>
                <Th>Last txn</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {rows.map((r) => (
                <tr key={r.userId} className="hover:bg-zinc-900/50">
                  <Td>
                    <div className="flex flex-col">
                      <span className="font-medium text-white">
                        {r.name ?? "—"}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {r.email ?? "no email"}
                      </span>
                    </div>
                  </Td>
                  <Td>{r.phone ?? "—"}</Td>
                  <Td align="right">
                    <span className="font-semibold text-emerald-400">
                      {r.pointsAvailable.toLocaleString("en-IN")}
                    </span>
                  </Td>
                  <Td align="right">
                    {r.pointsLifetimeEarned.toLocaleString("en-IN")}
                  </Td>
                  <Td align="right">
                    {r.pointsLifetimeRedeemed.toLocaleString("en-IN")}
                  </Td>
                  <Td>
                    {r.lastTransactionAt
                      ? new Date(r.lastTransactionAt).toLocaleDateString(
                          "en-IN",
                          { day: "numeric", month: "short", year: "numeric" },
                        )
                      : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      className={`px-4 py-2 text-sm text-zinc-200 ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {children}
    </td>
  );
}
