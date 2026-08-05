"use client";

import { useEffect, useState } from "react";
import { X, Plus, Trash2, Archive, ArchiveRestore } from "lucide-react";
import {
  adminEditTeam,
  archiveTournamentTeam,
  deleteTournamentTeam,
} from "@/actions/admin-tournaments";

export type TeamMemberRow = {
  id: string;
  name: string;
  phone: string | null;
  isCaptain: boolean;
  order: number;
};

export type TeamDetail = {
  id: string;
  name: string;
  status: string;
  color: string | null;
  logoUrl: string | null;
  captainName: string;
  captainPhone: string;
  captainEmail?: string | null;
  paidAmount: number;
  dueAmount: number;
  paymentMethod: string | null;
  paymentRef?: string | null;
  couponCode: string | null;
  discount?: number;
  pointsUsed?: number;
  pool: { name: string } | null;
  members: TeamMemberRow[];
  archivedAt: string | null;
  createdAt: string;
};

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/**
 * Full team record in one place — squad (name + phone, editable), the
 * money, and the destructive actions.
 *
 * Previously the squad was a comma-separated string in a single input,
 * which made "remove one player" a re-typing exercise and had nowhere to
 * put a phone number. Rows here are real fields; the server still keys
 * identity off the NAME, so an unchanged name keeps its recorded stats.
 *
 * Renders as a centred dialog on desktop and a full-height sheet on
 * mobile — the same component, since the content is identical.
 */
export function TeamDetailModal({
  team,
  maxMembers,
  onClose,
  onSaved,
}: {
  team: TeamDetail;
  maxMembers: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<{ name: string; phone: string }[]>(
    team.members.map((m) => ({ name: m.name, phone: m.phone ?? "" })),
  );
  const [teamName, setTeamName] = useState(team.name);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-seed when the parent hands us a different team (or fresh data
  // after a save) — otherwise the dialog would keep the old squad.
  useEffect(() => {
    setRows(team.members.map((m) => ({ name: m.name, phone: m.phone ?? "" })));
    setTeamName(team.name);
    setError(null);
  }, [team]);

  const archived = !!team.archivedAt;

  async function run(key: string, fn: () => Promise<{ success: boolean; error?: string }>) {
    setBusy(key);
    setError(null);
    try {
      const res = await fn();
      if (!res.success) setError(res.error || "Something went wrong");
      else onSaved();
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    run("save", () =>
      adminEditTeam(team.id, {
        name: teamName.trim() || team.name,
        members: rows
          .filter((r) => r.name.trim())
          .map((r) => ({ name: r.name.trim(), phone: r.phone.trim() })),
      }),
    );

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-zinc-800 bg-zinc-950 sm:max-h-[85vh] sm:max-w-2xl sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-white">
              {team.name}
            </p>
            <p className="text-xs text-zinc-500">
              {team.status.replace("_", " ")}
              {team.pool ? ` · ${team.pool.name}` : ""}
              {archived ? " · archived" : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {error && (
            <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          {/* Payment — the reason an admin opens a team most often. */}
          <section className="mb-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Payment
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-zinc-500">Paid</dt>
                <dd className="font-medium text-white">{inr(team.paidAmount)}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Due at venue</dt>
                <dd
                  className={`font-medium ${team.dueAmount > 0 ? "text-amber-400" : "text-white"}`}
                >
                  {inr(team.dueAmount)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Method</dt>
                <dd className="font-medium text-white">
                  {team.paymentMethod || "—"}
                </dd>
              </div>
              {team.couponCode ? (
                <div>
                  <dt className="text-xs text-zinc-500">Coupon</dt>
                  <dd className="font-medium text-white">
                    {team.couponCode}
                    {team.discount ? ` (−${inr(team.discount)})` : ""}
                  </dd>
                </div>
              ) : null}
              {team.pointsUsed ? (
                <div>
                  <dt className="text-xs text-zinc-500">Points used</dt>
                  <dd className="font-medium text-white">{team.pointsUsed}</dd>
                </div>
              ) : null}
              {team.paymentRef ? (
                <div className="col-span-2 sm:col-span-3">
                  <dt className="text-xs text-zinc-500">Reference</dt>
                  <dd className="break-all font-mono text-xs text-zinc-300">
                    {team.paymentRef}
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>

          {/* Captain */}
          <section className="mb-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Captain
            </h3>
            <p className="text-sm text-white">{team.captainName}</p>
            <p className="text-xs text-zinc-400">
              {team.captainPhone}
              {team.captainEmail ? ` · ${team.captainEmail}` : ""}
            </p>
          </section>

          {/* Team name */}
          <section className="mb-5">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Team name
            </label>
            <input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </section>

          {/* Squad */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Squad ({rows.length}/{maxMembers})
              </h3>
              <button
                onClick={() => setRows((r) => [...r, { name: "", phone: "" }])}
                disabled={rows.length >= maxMembers}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" /> Add player
              </button>
            </div>
            <div className="space-y-2">
              {rows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={row.name}
                    onChange={(e) =>
                      setRows((r) =>
                        r.map((x, j) =>
                          j === i ? { ...x, name: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder={`Player ${i + 1}`}
                    className="min-w-0 flex-[2] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
                  />
                  <input
                    value={row.phone}
                    onChange={(e) =>
                      setRows((r) =>
                        r.map((x, j) =>
                          j === i ? { ...x, phone: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder="Phone"
                    inputMode="tel"
                    className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
                  />
                  <button
                    onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                    aria-label={`Remove player ${i + 1}`}
                    className="shrink-0 rounded-lg border border-zinc-700 p-2 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              Keeping a player&apos;s name preserves their recorded stats.
              Players who already have stats can&apos;t be removed.
            </p>
          </section>
        </div>

        {/* Footer actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            onClick={save}
            disabled={busy !== null}
            className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {busy === "save" ? "Saving…" : "Save changes"}
          </button>

          <button
            onClick={() =>
              run("archive", () => archiveTournamentTeam(team.id, !archived))
            }
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            {archived ? (
              <>
                <ArchiveRestore className="h-3.5 w-3.5" /> Restore
              </>
            ) : (
              <>
                <Archive className="h-3.5 w-3.5" /> Archive
              </>
            )}
          </button>

          <button
            onClick={() => {
              if (
                !confirm(
                  `Delete "${team.name}" permanently? This can't be undone.`,
                )
              )
                return;
              void run("delete", async () => {
                const res = await deleteTournamentTeam(team.id);
                if (res.success) onClose();
                return res;
              });
            }}
            disabled={busy !== null}
            className="ml-auto rounded-lg border border-red-500/30 px-3 py-2 text-xs text-red-400 hover:bg-red-600/10 disabled:opacity-50"
          >
            {busy === "delete" ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
