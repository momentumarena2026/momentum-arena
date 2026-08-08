"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Shuffle, Eye, LayoutGrid, Trash2 } from "lucide-react";
import {
  autoAssignPools,
  clearPools,
  createEmptyPools,
  moveTeamToPool,
} from "@/actions/admin-tournament-fixtures";

type Team = { id: string; name: string; status: string; poolId?: string | null; color: string | null };
type Pool = { id: string; name: string; order: number };

export function PoolsTab({
  tournamentId,
  status,
  revealAt,
  pools,
  teams,
}: {
  tournamentId: string;
  status: string;
  revealAt: string | null;
  pools: Pool[];
  teams: Team[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const confirmed = teams.filter((t) => t.status === "CONFIRMED");
  const locked = !["REG_OPEN", "REG_CLOSED"].includes(status);

  const deal = async () => {
    setBusy("deal");
    setError(null);
    try {
      const res = await autoAssignPools(tournamentId);
      if (!res.success) setError(res.error || "Failed");
      else router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const makeEmpty = async () => {
    if (pools.length && !confirm("Replace the current pools with empty ones? Every team becomes unassigned.")) return;
    setBusy("empty");
    setError(null);
    try {
      const res = await createEmptyPools(tournamentId);
      if (!res.success) setError(res.error || "Failed");
      else router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const wipe = async () => {
    if (!confirm("Delete all pools? Every team becomes unassigned.")) return;
    setBusy("clear");
    setError(null);
    try {
      const res = await clearPools(tournamentId);
      if (!res.success) setError(res.error || "Failed");
      else router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const move = async (teamId: string, poolId: string) => {
    setBusy(teamId);
    setError(null);
    try {
      const res = await moveTeamToPool(teamId, poolId || null);
      if (!res.success) setError(res.error || "Failed");
      else router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={deal}
          disabled={busy === "deal" || locked}
          className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-600/10 px-4 py-2.5 text-sm font-medium text-emerald-400 hover:bg-emerald-600/20 disabled:opacity-40"
        >
          {busy === "deal" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shuffle className="h-4 w-4" />}
          {pools.length ? "Re-deal pools (random)" : "Deal pools (random)"}
        </button>
        {/* Build the grid by hand instead of re-rolling until the random
            deal happens to agree with you. */}
        <button
          onClick={makeEmpty}
          disabled={busy === "empty" || locked}
          className="flex items-center gap-2 rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:border-zinc-600 disabled:opacity-40"
        >
          {busy === "empty" ? <Loader2 className="h-4 w-4 animate-spin" /> : <LayoutGrid className="h-4 w-4" />}
          Create empty pools
        </button>
        {pools.length > 0 && (
          <button
            onClick={wipe}
            disabled={busy === "clear" || locked}
            className="flex items-center gap-2 rounded-xl border border-red-500/30 px-4 py-2.5 text-sm font-medium text-red-400 hover:bg-red-600/10 disabled:opacity-40"
          >
            {busy === "clear" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Clear pools
          </button>
        )}
        {revealAt && (
          <span className="flex items-center gap-1.5 text-xs text-violet-400">
            <Eye className="h-3.5 w-3.5" /> Reveal countdown set:{" "}
            {new Date(revealAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
          </span>
        )}
        {locked && <span className="text-xs text-zinc-500">Pools are locked after the reveal.</span>}
      </div>
      <p className="text-xs text-zinc-500">
        Pools stay hidden from customers until you move the tournament to{" "}
        <span className="text-violet-400">Pools Revealed</span> (or the reveal countdown hits zero
        after you transition). The random deal groups teams by the slots they said they can play, so
        a pool&apos;s round-robin fits the windows its members share — re-deal for a different
        arrangement, start from empty pools to build it yourself, and use the per-team selector
        either way.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {pools.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center text-sm text-zinc-500">
          No pools dealt yet. {confirmed.length} confirmed teams ready.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {pools.map((pool) => {
            const poolTeams = confirmed.filter((t) => t.poolId === pool.id);
            return (
              <div key={pool.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                <h4 className="mb-3 font-semibold text-violet-300">{pool.name}</h4>
                <div className="space-y-2">
                  {poolTeams.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 rounded-lg bg-zinc-800/60 p-2">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: t.color || "#52525b" }} />
                      <span className="flex-1 truncate text-sm text-zinc-200">{t.name}</span>
                      {!locked && (
                        <select
                          className="rounded border border-zinc-700 bg-zinc-800 p-1 text-xs text-zinc-400"
                          value={pool.id}
                          disabled={busy === t.id}
                          onChange={(e) => move(t.id, e.target.value)}
                        >
                          {pools.map((p) => (
                            <option key={p.id} value={p.id}>{p.name.replace("Pool ", "")}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  ))}
                  {poolTeams.length === 0 && <p className="text-xs text-zinc-600">Empty</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Unassigned confirmed teams */}
      {pools.length > 0 && confirmed.some((t) => !t.poolId) && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <h4 className="mb-2 text-sm font-medium text-amber-400">Unassigned teams</h4>
          <div className="flex flex-wrap gap-2">
            {confirmed
              .filter((t) => !t.poolId)
              .map((t) => (
                <div key={t.id} className="flex items-center gap-2 rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200">
                  {t.name}
                  <select
                    className="rounded border border-zinc-700 bg-zinc-900 p-1 text-xs text-zinc-400"
                    value=""
                    disabled={busy === t.id}
                    onChange={(e) => e.target.value && move(t.id, e.target.value)}
                  >
                    <option value="">Assign…</option>
                    {pools.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
