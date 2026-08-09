"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GripVertical, Loader2, Users, X } from "lucide-react";
import { moveTeamToPool } from "@/actions/admin-tournament-fixtures";

/**
 * Hand-built pool draw: unassigned teams on the right, pool containers on
 * the left, drag a team across.
 *
 * Two things drove the design beyond "make it draggable":
 *
 * 1. Availability is the whole reason pooling is hard. The random deal
 *    groups teams by the windows they said they can play, because a
 *    pool's round-robin has to fit a window its members share. Building
 *    by hand without that information in front of you produces a pool
 *    that can't be scheduled, and you don't find out until the fixture
 *    generator fails. So every team card carries its windows, and each
 *    pool shows what its current members still have in common — live, as
 *    you drag.
 *
 * 2. HTML5 drag events don't fire on touch. Rather than pull in a drag
 *    library for one screen, every drag has a tap equivalent: tap a team
 *    to pick it up, tap a pool to drop it. That path is also the keyboard
 *    path, since both are real buttons.
 */

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

const hourLabel = (h: number) => {
  const hr = h % 24;
  const am = hr < 12;
  const v = hr % 12 === 0 ? 12 : hr % 12;
  return `${v}${am ? "am" : "pm"}`;
};

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });

export function PoolBoard({
  pools,
  teams,
  slots,
  teamsPerPool,
  locked,
}: {
  pools: Pool[];
  teams: Team[];
  slots: Slot[];
  teamsPerPool: number;
  locked: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyTeam, setBusyTeam] = useState<string | null>(null);
  const [dragTeam, setDragTeam] = useState<string | null>(null);
  const [overPool, setOverPool] = useState<string | null>(null);
  /** Tap-to-place: the team waiting for somewhere to land. */
  const [held, setHeld] = useState<string | null>(null);
  /** Optimistic overrides so a card moves the instant you drop it. */
  const [moved, setMoved] = useState<Record<string, string | null>>({});
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poolOf = useCallback(
    (t: Team) => (t.id in moved ? moved[t.id] : (t.poolId ?? null)),
    [moved],
  );

  const slotById = useMemo(() => new Map(slots.map((s) => [s.id, s])), [slots]);

  /** `<slotId>#<hour>` → "Sat 9 Aug · 6pm". */
  const keyLabel = useCallback(
    (key: string) => {
      const [slotId, raw] = key.split("#");
      const slot = slotById.get(slotId);
      const hour = Number(raw);
      if (!slot || !Number.isInteger(hour)) return null;
      return `${dayLabel(slot.date)} · ${hourLabel(hour)}`;
    },
    [slotById],
  );

  const assign = async (teamId: string, poolId: string | null) => {
    if (locked) return;
    const team = teams.find((t) => t.id === teamId);
    if (!team || poolOf(team) === poolId) {
      setHeld(null);
      return;
    }
    const previous = poolOf(team);
    setMoved((m) => ({ ...m, [teamId]: poolId }));
    setHeld(null);
    setBusyTeam(teamId);
    setError(null);
    try {
      // A thrown action — an expired admin session is the likely one — has
      // to revert too, or the board keeps showing a move that never
      // reached the database.
      const res = await moveTeamToPool(teamId, poolId).catch(() => ({
        success: false as const,
        error: "Could not reach the server — check you are still signed in",
      }));
      if (!res.success) {
        // Put it back where it was rather than leaving the board showing
        // an arrangement the server rejected.
        setMoved((m) => ({ ...m, [teamId]: previous }));
        setError(res.error || "Could not move that team");
        return;
      }
      // Let the board settle before re-syncing, so a run of quick drops
      // isn't interrupted by a refresh between each one.
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 800);
    } finally {
      setBusyTeam(null);
    }
  };

  const unassigned = teams.filter((t) => !poolOf(t));

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}
      {held && (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-300">
          {teams.find((t) => t.id === held)?.name} picked up — tap a pool to place it, or tap the
          team again to cancel.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* ── Pools ─────────────────────────────────────────────── */}
        <div className="grid gap-3 sm:grid-cols-2">
          {pools.map((pool) => {
            const members = teams.filter((t) => poolOf(t) === pool.id);
            const over = teamsPerPool > 0 && members.length > teamsPerPool;
            const active = overPool === pool.id;
            return (
              <div
                key={pool.id}
                onDragOver={(e) => {
                  if (locked || !dragTeam) return;
                  e.preventDefault();
                  setOverPool(pool.id);
                }}
                onDragLeave={() => setOverPool((p) => (p === pool.id ? null : p))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOverPool(null);
                  const id = e.dataTransfer.getData("text/plain") || dragTeam;
                  if (id) void assign(id, pool.id);
                }}
                className={`rounded-xl border p-3 transition-colors ${
                  active
                    ? "border-emerald-500 bg-emerald-500/10"
                    : held
                      ? "border-emerald-500/40 bg-zinc-900"
                      : "border-zinc-800 bg-zinc-900"
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h4 className="font-semibold text-violet-300">{pool.name}</h4>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      over
                        ? "bg-amber-500/15 text-amber-400"
                        : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {members.length}
                    {teamsPerPool > 0 ? ` / ${teamsPerPool}` : ""}
                  </span>
                </div>

                <div className="space-y-1.5">
                  {members.map((t) => (
                    <TeamCard
                      key={t.id}
                      team={t}
                      keyLabel={keyLabel}
                      locked={locked}
                      busy={busyTeam === t.id}
                      held={held === t.id}
                      onDragStart={() => setDragTeam(t.id)}
                      onDragEnd={() => {
                        setDragTeam(null);
                        setOverPool(null);
                      }}
                      onTap={() => setHeld((h) => (h === t.id ? null : t.id))}
                      onRemove={() => void assign(t.id, null)}
                    />
                  ))}
                  {members.length === 0 && (
                    <button
                      type="button"
                      disabled={locked || !held}
                      onClick={() => held && void assign(held, pool.id)}
                      className="w-full rounded-lg border border-dashed border-zinc-700 px-3 py-5 text-xs text-zinc-600 disabled:cursor-default enabled:hover:border-emerald-500/50 enabled:hover:text-emerald-400"
                    >
                      {held ? "Tap to place here" : "Drop teams here"}
                    </button>
                  )}
                </div>

                {/* What this pool can still be scheduled in. */}
                <SharedWindows members={members} keyLabel={keyLabel} />

                {held && members.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void assign(held, pool.id)}
                    className="mt-2 w-full rounded-lg border border-dashed border-emerald-500/40 py-1.5 text-xs text-emerald-400 hover:bg-emerald-500/10"
                  >
                    Tap to place here
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Registered teams ──────────────────────────────────── */}
        <div
          onDragOver={(e) => {
            if (locked || !dragTeam) return;
            e.preventDefault();
            setOverPool("__none__");
          }}
          onDragLeave={() => setOverPool((p) => (p === "__none__" ? null : p))}
          onDrop={(e) => {
            e.preventDefault();
            setOverPool(null);
            const id = e.dataTransfer.getData("text/plain") || dragTeam;
            if (id) void assign(id, null);
          }}
          className={`h-fit rounded-xl border p-3 lg:sticky lg:top-4 ${
            overPool === "__none__"
              ? "border-emerald-500 bg-emerald-500/10"
              : "border-zinc-800 bg-zinc-900"
          }`}
        >
          <div className="mb-2 flex items-center gap-2">
            <Users className="h-4 w-4 text-zinc-500" />
            <h4 className="flex-1 text-sm font-semibold text-zinc-200">Registered teams</h4>
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
              {unassigned.length}
            </span>
          </div>
          <p className="mb-2.5 text-[11px] leading-relaxed text-zinc-500">
            Drag a team into a pool, or tap it and then tap the pool. Times below are the windows
            each captain said they can play.
          </p>
          <div className="max-h-[32rem] space-y-1.5 overflow-y-auto pr-1">
            {unassigned.map((t) => (
              <TeamCard
                key={t.id}
                team={t}
                keyLabel={keyLabel}
                locked={locked}
                busy={busyTeam === t.id}
                held={held === t.id}
                onDragStart={() => setDragTeam(t.id)}
                onDragEnd={() => {
                  setDragTeam(null);
                  setOverPool(null);
                }}
                onTap={() => setHeld((h) => (h === t.id ? null : t.id))}
              />
            ))}
            {unassigned.length === 0 && (
              <p className="py-6 text-center text-xs text-zinc-600">
                Every confirmed team is in a pool.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Windows every constrained member of a pool still shares. */
function SharedWindows({
  members,
  keyLabel,
}: {
  members: Team[];
  keyLabel: (key: string) => string | null;
}) {
  const shared = useMemo(() => {
    // A team that picked nothing plays any time, so it narrows nothing.
    const constrained = members.filter((m) => m.preferredSlotIds.length > 0);
    if (members.length < 2 || constrained.length === 0) return null;
    return constrained
      .slice(1)
      .reduce(
        (acc, t) => acc.filter((k) => t.preferredSlotIds.includes(k)),
        [...constrained[0].preferredSlotIds],
      );
  }, [members]);

  if (shared === null) return null;

  if (shared.length === 0) {
    return (
      <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-2 py-1.5 text-[11px] text-amber-400">
        No window works for all of these teams — this pool can&apos;t be scheduled as it stands.
      </p>
    );
  }
  const labels = shared.map(keyLabel).filter(Boolean) as string[];
  return (
    <p className="mt-2 text-[11px] text-emerald-500/80">
      Shares {labels.length} window{labels.length === 1 ? "" : "s"}
      {labels.length > 0 && <span className="text-zinc-500"> · {labels.slice(0, 2).join(", ")}</span>}
      {labels.length > 2 && <span className="text-zinc-600"> +{labels.length - 2}</span>}
    </p>
  );
}

function TeamCard({
  team,
  keyLabel,
  locked,
  busy,
  held,
  onDragStart,
  onDragEnd,
  onTap,
  onRemove,
}: {
  team: Team;
  keyLabel: (key: string) => string | null;
  locked: boolean;
  busy: boolean;
  held: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onTap: () => void;
  onRemove?: () => void;
}) {
  const windows = team.preferredSlotIds.map(keyLabel).filter(Boolean) as string[];
  return (
    <div
      draggable={!locked}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", team.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`group flex items-start gap-2 rounded-lg border p-2 ${
        held
          ? "border-emerald-500 bg-emerald-500/10"
          : "border-transparent bg-zinc-800/60 hover:border-zinc-700"
      } ${locked ? "" : "cursor-grab active:cursor-grabbing"}`}
    >
      {!locked && (
        <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600" />
      )}
      <span
        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: team.color || "#52525b" }}
      />
      <button
        type="button"
        disabled={locked}
        onClick={onTap}
        className="min-w-0 flex-1 text-left disabled:cursor-default"
      >
        <span className="block truncate text-sm text-zinc-200">{team.name}</span>
        {windows.length > 0 ? (
          <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
            {windows.slice(0, 2).join(" · ")}
            {windows.length > 2 ? ` +${windows.length - 2}` : ""}
          </span>
        ) : (
          <span className="mt-0.5 block text-[11px] text-zinc-600">Any time</span>
        )}
      </button>
      {busy && <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-zinc-500" />}
      {!busy && onRemove && !locked && (
        <button
          type="button"
          onClick={onRemove}
          title="Move back to registered teams"
          className="mt-0.5 shrink-0 text-zinc-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
