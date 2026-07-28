"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, Users, ChevronDown, ChevronUp, Lock } from "lucide-react";

type Member = { id: string; name: string; isCaptain: boolean; locked: boolean };

type Props = {
  teamId: string;
  members: Member[];
  maxMembers: number;
  canEdit: boolean;
};

/** Captain's post-registration squad editor — registration only needs the
 *  captain, the squad is built here (optional, any time before the
 *  tournament ends). Sends the full desired list; the server reconciles
 *  it stat-safely. */
export function SquadManager({ teamId, members, maxMembers, canEdit }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(members.length <= 1);
  const [rows, setRows] = useState<{ key: string; name: string; locked: boolean; isCaptain: boolean }[]>(
    members.map((m) => ({ key: m.id, name: m.name, locked: m.locked, isCaptain: m.isCaptain }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const filled = rows.map((r) => r.name.trim()).filter(Boolean);
  const dirty =
    filled.length !== members.length ||
    filled.some((n, i) => n !== members[i]?.name);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/tournaments/squad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, members: filled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't save the squad");
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the squad");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/60">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between p-4 text-left"
      >
        <span className="flex items-center gap-2 font-semibold text-white">
          <Users className="h-5 w-5 text-emerald-400" /> Your Squad
          <span className="text-sm font-normal text-zinc-500">
            ({members.length}/{maxMembers} players)
          </span>
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-zinc-500" /> : <ChevronDown className="h-4 w-4 text-zinc-500" />}
      </button>

      {open && (
        <div className="space-y-3 border-t border-zinc-800 p-4">
          {!canEdit ? (
            <p className="text-sm text-zinc-500">The tournament has ended — the squad is locked.</p>
          ) : (
            <>
              <p className="text-xs text-zinc-500">
                Add your players any time before the tournament ends — it&apos;s optional.
              </p>
              <div className="space-y-2">
                {rows.map((r, i) => (
                  <div key={r.key} className="flex items-center gap-2">
                    <span className="flex w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800 py-2 text-xs text-zinc-500">
                      {i + 1}
                    </span>
                    <input
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-500/50 focus:outline-none"
                      placeholder={`Player ${i + 1}`}
                      value={r.name}
                      onChange={(e) =>
                        setRows((arr) => arr.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                      }
                    />
                    {r.isCaptain && (
                      <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400">
                        C
                      </span>
                    )}
                    {r.locked ? (
                      <span title="Has recorded stats" className="shrink-0 p-2 text-zinc-600">
                        <Lock className="h-4 w-4" />
                      </span>
                    ) : rows.length > 1 ? (
                      <button
                        onClick={() => setRows((arr) => arr.filter((_, j) => j !== i))}
                        className="shrink-0 rounded-lg border border-zinc-700 p-2 text-zinc-500 hover:bg-zinc-800"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              {rows.length < maxMembers && (
                <button
                  onClick={() =>
                    setRows((arr) => [
                      ...arr,
                      { key: `new-${Date.now()}-${arr.length}`, name: "", locked: false, isCaptain: false },
                    ])
                  }
                  className="flex items-center gap-1 text-xs text-emerald-400 hover:underline"
                >
                  <Plus className="h-3 w-3" /> Add player
                </button>
              )}
              {error && <p className="text-sm text-red-400">{error}</p>}
              {saved && !dirty && <p className="text-sm text-emerald-400">Squad saved ✓</p>}
              {dirty && (
                <button
                  onClick={save}
                  disabled={saving || filled.length === 0}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save squad
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
