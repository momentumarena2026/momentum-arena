"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Shuffle, Eye, LayoutGrid, Trash2 } from "lucide-react";
import {
  autoAssignPools,
  clearPools,
  createEmptyPools,
} from "@/actions/admin-tournament-fixtures";
import { PoolBoard } from "./pool-board";

type Team = {
  id: string;
  name: string;
  status: string;
  poolId?: string | null;
  color: string | null;
  preferredSlotIds: string[];
};
type Pool = { id: string; name: string; order: number };
type Slot = {
  id: string;
  date: string;
  startHour: number;
  endHour: number;
  label: string | null;
  courtConfig: { label: string } | null;
};

export function PoolsTab({
  tournamentId,
  status,
  revealAt,
  pools,
  teams,
  slots,
  teamsPerPool,
}: {
  tournamentId: string;
  status: string;
  revealAt: string | null;
  pools: Pool[];
  teams: Team[];
  slots: Slot[];
  teamsPerPool: number;
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
        arrangement, or start from empty pools and drag teams in yourself.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {pools.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center text-sm text-zinc-500">
          No pools dealt yet. {confirmed.length} confirmed teams ready.
        </div>
      ) : (
        <PoolBoard
          pools={pools}
          teams={confirmed}
          slots={slots}
          teamsPerPool={teamsPerPool}
          locked={locked}
        />
      )}
    </div>
  );
}
