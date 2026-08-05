import Link from "next/link";
import { TournamentHubTracker } from "./hub-tracker";
import { Trophy, Users, IndianRupee, Radio, ChevronLeft, ChevronRight } from "lucide-react";
import { listPublicTournaments } from "@/lib/tournaments";

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

// Category buckets, in display priority order:
//   Active (1) — matches underway right now
//   Upcoming (2) — announced through pools-revealed, not yet playing
//   Finished (3) — completed
type Category = "Active" | "Upcoming" | "Finished";

function categoryOf(status: string): Category {
  if (status === "LIVE") return "Active";
  if (status === "COMPLETED") return "Finished";
  return "Upcoming";
}

const CATEGORY_STYLE: Record<Category, { chip: string; dot: string }> = {
  Active: { chip: "bg-red-500/10 text-red-400 border-red-500/30", dot: "🔴" },
  Upcoming: { chip: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30", dot: "🟢" },
  Finished: { chip: "bg-zinc-500/10 text-zinc-400 border-zinc-600/30", dot: "🏁" },
};

const STATUS_LABEL: Record<string, string> = {
  PUBLISHED: "Announced",
  REG_OPEN: "Registrations open",
  REG_CLOSED: "Registrations closed",
  POOLS_REVEALED: "Pools out",
  LIVE: "LIVE",
  COMPLETED: "Finished",
};

const PAGE_SIZE = 9;

export default async function TournamentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageRaw } = await searchParams;
  const rows = await listPublicTournaments();

  // Priority: Active → Upcoming → Finished; inside each, latest date first.
  const when = (t: (typeof rows)[number]) =>
    new Date(t.startDate ?? t.regCloseAt ?? 0).getTime();
  const rank: Record<Category, number> = { Active: 0, Upcoming: 1, Finished: 2 };
  const ordered = [...rows].sort((a, b) => {
    const ca = rank[categoryOf(a.status)];
    const cb = rank[categoryOf(b.status)];
    if (ca !== cb) return ca - cb;
    return when(b) - when(a); // descending date within a category
  });

  const totalPages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  const page = Math.min(totalPages, Math.max(1, parseInt(pageRaw || "1", 10) || 1));
  const pageRows = ordered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Group the current page's rows by category for section headers.
  const sections = (["Active", "Upcoming", "Finished"] as Category[])
    .map((cat) => ({ cat, items: pageRows.filter((t) => categoryOf(t.status) === cat) }))
    .filter((s) => s.items.length > 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <TournamentHubTracker />
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-white sm:text-4xl">🏆 Tournaments</h1>
        <p className="mt-2 text-zinc-400">
          Register your team. Fight through the pools. Lift the trophy.
        </p>
      </div>

      {ordered.length === 0 && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-12 text-center">
          <Trophy className="mx-auto h-12 w-12 text-zinc-700" />
          <p className="mt-4 text-zinc-400">No tournaments announced yet — stay tuned!</p>
        </div>
      )}

      {sections.map(({ cat, items }) => (
        <section key={cat} className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
            {CATEGORY_STYLE[cat].dot} {cat}
            <span className="text-sm font-normal text-zinc-500">({items.length})</span>
          </h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((t) => (
              <Link
                key={t.id}
                href={`/tournaments/${t.slug}`}
                className="group overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60 transition hover:border-emerald-500/40"
              >
                {t.bannerImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.bannerImageUrl} alt="" className="h-32 w-full object-cover" />
                ) : (
                  <div className="flex h-32 items-center justify-center bg-gradient-to-br from-emerald-900/60 to-zinc-900 text-5xl">
                    {SPORT_EMOJI[t.sport] || "🏆"}
                  </div>
                )}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-white group-hover:text-emerald-300">
                      {t.name}
                    </h3>
                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs ${CATEGORY_STYLE[cat].chip}`}
                    >
                      {t.status === "LIVE" ? "● LIVE" : STATUS_LABEL[t.status] || t.status}
                    </span>
                  </div>
                  {t.startDate && (
                    <p className="mt-1 text-xs text-zinc-500">
                      {/* Server-rendered: without an explicit zone this
                          formats in the SERVER's zone (UTC on Vercel), so a
                          tournament starting 1 Aug 00:30 IST showed 31 Jul.
                          Tournament times are venue wall-clock — always IST. */}
                      {new Date(t.startDate).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        timeZone: "Asia/Kolkata",
                      })}
                    </p>
                  )}
                  <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-400">
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" /> {t._count.teams}/{t.totalTeams}
                    </span>
                    {t.prizePool ? (
                      <span className="flex items-center gap-1 text-amber-400">
                        <Trophy className="h-3.5 w-3.5" /> ₹{t.prizePool.toLocaleString("en-IN")}
                      </span>
                    ) : null}
                    {t.feeMode !== "FREE" && t.entryFee > 0 && (
                      <span className="flex items-center gap-1">
                        <IndianRupee className="h-3.5 w-3.5" /> {t.entryFee.toLocaleString("en-IN")}
                      </span>
                    )}
                    {t.liveScoringEnabled && cat === "Active" && (
                      <span className="flex items-center gap-1 text-red-400">
                        <Radio className="h-3.5 w-3.5" /> Live scores
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}

      {/* Pagination */}
      {totalPages > 1 && (
        <nav className="mt-4 flex items-center justify-center gap-2">
          <Link
            href={`/tournaments?page=${page - 1}`}
            aria-disabled={page <= 1}
            className={`flex items-center gap-1 rounded-lg border border-zinc-700 px-3 py-2 text-sm ${
              page <= 1 ? "pointer-events-none opacity-40" : "text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            <ChevronLeft className="h-4 w-4" /> Prev
          </Link>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={`/tournaments?page=${p}`}
              className={`rounded-lg border px-3.5 py-2 text-sm ${
                p === page
                  ? "border-emerald-500/50 bg-emerald-600/10 text-emerald-300"
                  : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {p}
            </Link>
          ))}
          <Link
            href={`/tournaments?page=${page + 1}`}
            aria-disabled={page >= totalPages}
            className={`flex items-center gap-1 rounded-lg border border-zinc-700 px-3 py-2 text-sm ${
              page >= totalPages ? "pointer-events-none opacity-40" : "text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            Next <ChevronRight className="h-4 w-4" />
          </Link>
        </nav>
      )}
    </div>
  );
}
