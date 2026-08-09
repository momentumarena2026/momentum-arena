import Link from "next/link";
import { Archive, BookOpen, Plus, Trophy } from "lucide-react";
import { listTournamentsAdmin, getTournamentsEnabled } from "@/actions/admin-tournaments";
import { STATUS_LABELS } from "@/lib/tournament-config";
import { ModuleToggle } from "./module-toggle";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "text-zinc-400 border-zinc-700",
  PUBLISHED: "text-sky-400 border-sky-500/40",
  REG_OPEN: "text-emerald-400 border-emerald-500/40",
  REG_CLOSED: "text-amber-400 border-amber-500/40",
  POOLS_REVEALED: "text-violet-400 border-violet-500/40",
  LIVE: "text-red-400 border-red-500/40",
  COMPLETED: "text-zinc-300 border-zinc-600",
  CANCELLED: "text-zinc-500 border-zinc-800",
};

export default async function AdminTournamentsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  // Archived events are out of the way by default but one click from view,
  // because "where did last season go" is a question the list has to be
  // able to answer.
  const showArchived = (await searchParams).archived === "1";
  const [tournaments, enabled] = await Promise.all([
    listTournamentsAdmin(showArchived),
    getTournamentsEnabled(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Tournaments</h1>
          <p className="mt-1 text-zinc-400">
            Create and run tournaments — teams, pools, fixtures, scoring and marketing.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ModuleToggle initialEnabled={enabled} />
          <Link
            href="/admin/tournaments/docs"
            className="flex shrink-0 items-center gap-2 rounded-xl border border-zinc-700 px-4 py-3 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
          >
            <BookOpen className="h-4 w-4" /> How to use
          </Link>
          <Link
            href={showArchived ? "/admin/tournaments" : "/admin/tournaments?archived=1"}
            className="flex shrink-0 items-center gap-2 rounded-xl border border-zinc-700 px-4 py-3 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
          >
            <Archive className="h-4 w-4" />
            {showArchived ? "Hide archived" : "Show archived"}
          </Link>
          <Link
            href="/admin/tournaments/new"
            className="flex shrink-0 items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-600/10 px-4 py-3 text-sm font-medium text-emerald-400 hover:bg-emerald-600/20"
          >
            <Plus className="h-4 w-4" /> New Tournament
          </Link>
        </div>
      </div>

      {tournaments.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-10 text-center">
          <Trophy className="mx-auto h-10 w-10 text-zinc-700" />
          <p className="mt-3 text-zinc-400">
            {showArchived
              ? "Nothing here — no tournaments at all yet."
              : "No active tournaments. Create one, or show the archived ones."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {tournaments.map((t) => (
            <Link
              key={t.id}
              href={`/admin/tournaments/${t.id}`}
              className={`rounded-xl border bg-zinc-900 p-5 transition hover:border-zinc-700 ${
                t.archivedAt ? "border-zinc-800/60 opacity-60" : "border-zinc-800"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium text-white">{t.name}</h3>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {t.sport} · {t.format === "POOLS_KNOCKOUT" ? "Pools → Knockout" : t.format === "LEAGUE" ? "League" : "Knockout"} · {t.totalTeams} teams
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1.5">
                  {t.archivedAt && (
                    <span className="rounded-full border border-zinc-700 px-2 py-1 text-xs text-zinc-500">
                      Archived
                    </span>
                  )}
                  <span className={`rounded-full border px-2.5 py-1 text-xs ${STATUS_COLORS[t.status] || ""}`}>
                    {STATUS_LABELS[t.status] || t.status}
                  </span>
                </span>
              </div>
              <div className="mt-3 flex gap-4 text-xs text-zinc-400">
                <span>{t._count.teams} registered</span>
                <span>{t._count.matches} matches</span>
                {t.entryFee > 0 && <span>₹{t.entryFee.toLocaleString("en-IN")}/team</span>}
                {t.liveScoringEnabled && <span className="text-red-400">● Live scoring</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
