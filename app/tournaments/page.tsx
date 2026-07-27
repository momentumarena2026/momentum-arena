import Link from "next/link";
import { Trophy, Users, IndianRupee, Radio } from "lucide-react";
import { listPublicTournaments } from "@/lib/tournaments";
import { STATUS_LABELS } from "@/lib/tournament-config";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tournaments | Momentum Arena",
  description: "Compete in cricket, football and pickleball tournaments at Momentum Arena.",
};

const SPORT_EMOJI: Record<string, string> = {
  CRICKET: "🏏",
  FOOTBALL: "⚽",
  PICKLEBALL: "🎾",
};

const STATUS_STYLE: Record<string, string> = {
  PUBLISHED: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  REG_OPEN: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  REG_CLOSED: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  POOLS_REVEALED: "bg-violet-500/10 text-violet-400 border-violet-500/30",
  LIVE: "bg-red-500/10 text-red-400 border-red-500/30",
  COMPLETED: "bg-zinc-500/10 text-zinc-400 border-zinc-600/30",
};

export default async function TournamentsPage() {
  const tournaments = await listPublicTournaments();
  const active = tournaments.filter((t) => t.status !== "COMPLETED");
  const past = tournaments.filter((t) => t.status === "COMPLETED");

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-white sm:text-4xl">🏆 Tournaments</h1>
        <p className="mt-2 text-zinc-400">
          Register your team. Fight through the pools. Lift the trophy.
        </p>
      </div>

      {tournaments.length === 0 && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-12 text-center">
          <Trophy className="mx-auto h-12 w-12 text-zinc-700" />
          <p className="mt-4 text-zinc-400">No tournaments announced yet — stay tuned!</p>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        {active.map((t) => (
          <Link
            key={t.id}
            href={`/tournaments/${t.slug}`}
            className="group overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60 transition hover:border-emerald-500/40"
          >
            {t.bannerImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={t.bannerImageUrl} alt="" className="h-36 w-full object-cover" />
            ) : (
              <div className="flex h-36 items-center justify-center bg-gradient-to-br from-emerald-900/60 to-zinc-900 text-5xl">
                {SPORT_EMOJI[t.sport] || "🏆"}
              </div>
            )}
            <div className="p-5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-white group-hover:text-emerald-300">{t.name}</h3>
                <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs ${STATUS_STYLE[t.status] || ""}`}>
                  {t.status === "LIVE" ? "● LIVE" : STATUS_LABELS[t.status] || t.status}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-400">
                <span className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" /> {t._count.teams}/{t.totalTeams} teams
                </span>
                {t.prizePool ? (
                  <span className="flex items-center gap-1 text-amber-400">
                    <Trophy className="h-3.5 w-3.5" /> ₹{t.prizePool.toLocaleString("en-IN")} prize pool
                  </span>
                ) : null}
                {t.feeMode !== "FREE" && t.entryFee > 0 && (
                  <span className="flex items-center gap-1">
                    <IndianRupee className="h-3.5 w-3.5" /> {t.entryFee.toLocaleString("en-IN")}/team
                  </span>
                )}
                {t.liveScoringEnabled && (
                  <span className="flex items-center gap-1 text-red-400">
                    <Radio className="h-3.5 w-3.5" /> Live scores
                  </span>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {past.length > 0 && (
        <>
          <h2 className="mb-4 mt-10 text-lg font-semibold text-zinc-300">Past tournaments</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {past.map((t) => (
              <Link
                key={t.id}
                href={`/tournaments/${t.slug}`}
                className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-300 hover:border-zinc-700"
              >
                {SPORT_EMOJI[t.sport]} {t.name}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
