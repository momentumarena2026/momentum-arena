"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adjustPassMinutes,
  cancelUserPass,
  extendPassValidity,
} from "@/actions/admin-passes";

interface Sold {
  id: string;
  name: string;
  customer: string;
  phone: string;
  totalMinutes: number;
  remainingMinutes: number;
  price: number;
  status: string;
  purchasedAt: string;
  expiresAt: string;
  redemptionCount: number;
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const hrs = (m: number) => `${(m / 60).toFixed(1).replace(/\.0$/, "")}h`;
const dt = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
  });

/** Sold-pass management: search, extend validity, adjust balance,
 *  cancel. Refunds stay manual (gateway dashboard) per policy. */
export function SoldPasses({ passes }: { passes: Sold[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  const filtered = passes.filter(
    (p) =>
      !q ||
      p.phone.includes(q) ||
      p.customer.toLowerCase().includes(q.toLowerCase()),
  );

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Failed");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">Sold passes</h2>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name / phone…"
          className="w-56 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-600 focus:outline-none"
        />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {filtered.length === 0 ? (
        <p className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-400">
          No passes sold yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Pass</th>
                <th className="px-4 py-3">Balance</th>
                <th className="px-4 py-3">Paid</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-zinc-800/60 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-white">{p.customer}</p>
                    <p className="text-xs text-zinc-500">{p.phone}</p>
                  </td>
                  <td className="px-4 py-3 text-zinc-300">
                    {p.name}
                    <p className="text-xs text-zinc-500">
                      bought {dt(p.purchasedAt)} · {p.redemptionCount} redemption(s)
                    </p>
                  </td>
                  <td className="px-4 py-3 text-zinc-300">
                    {hrs(p.remainingMinutes)} / {hrs(p.totalMinutes)}
                  </td>
                  <td className="px-4 py-3 text-zinc-300">{inr(p.price)}</td>
                  <td className="px-4 py-3 text-zinc-300">{dt(p.expiresAt)}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2 text-xs">
                      <button
                        disabled={pending}
                        onClick={() => {
                          const d = window.prompt("Extend validity by how many days?", "7");
                          if (!d) return;
                          run(() => extendPassValidity(p.id, parseInt(d, 10)));
                        }}
                        className="rounded-md border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800"
                      >
                        Extend
                      </button>
                      <button
                        disabled={pending}
                        onClick={() => {
                          const m = window.prompt(
                            "Adjust balance by minutes (e.g. 60 or -30):",
                            "60",
                          );
                          if (!m) return;
                          run(() => adjustPassMinutes(p.id, parseInt(m, 10)));
                        }}
                        className="rounded-md border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800"
                      >
                        Adjust
                      </button>
                      <button
                        disabled={pending || p.status === "CANCELLED"}
                        onClick={() => {
                          if (!window.confirm(`Cancel ${p.customer}'s pass? Refund (if any) is manual via the gateway dashboard.`)) return;
                          run(() => cancelUserPass(p.id));
                        }}
                        className="rounded-md border border-red-900/50 px-2 py-1 text-red-400 hover:bg-red-500/10"
                      >
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
