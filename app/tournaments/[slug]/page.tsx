import Link from "next/link";
import { notFound } from "next/navigation";
import { Trophy, Users, IndianRupee, CalendarDays, Radio, ChevronRight } from "lucide-react";
import { getPublicTournamentBySlug } from "@/lib/tournaments";
import { onlinePayable, parsePrizes, STATUS_LABELS } from "@/lib/tournament-config";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const SPORT_LABEL: Record<string, string> = {
  CRICKET: "🏏 Cricket",
  FOOTBALL: "⚽ Football",
  PICKLEBALL: "🎾 Pickleball",
};

function fmtDate(d: Date | null): string {
  if (!d) return "TBA";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default async function TournamentPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [t, session] = await Promise.all([getPublicTournamentBySlug(slug), auth()]);
  if (!t) notFound();

  const confirmed = t.teams.filter((x) => x.status === "CONFIRMED");
  const spotsLeft = Math.max(0, t.totalTeams - confirmed.length);
  const payable = onlinePayable(t.entryFee, t.feeMode, t.advancePct);
  const prizes = parsePrizes(t.prizes);
  const myTeam = session?.user?.id
    ? t.teams.find((x) => x.captainUserId === session.user!.id)
    : null;
  const canRegister = t.status === "REG_OPEN" && !myTeam;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Hero */}
      <div className="overflow-hidden rounded-2xl border border-zinc-800">
        {t.bannerImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.bannerImageUrl} alt="" className="h-48 w-full object-cover sm:h-64" />
        ) : (
          <div className="flex h-48 items-center justify-center bg-gradient-to-br from-emerald-900/70 via-zinc-900 to-zinc-950 sm:h-64">
            <Trophy className="h-16 w-16 text-emerald-500/60" />
          </div>
        )}
        <div className="bg-zinc-900/80 p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-zinc-400">{SPORT_LABEL[t.sport] || t.sport}</span>
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs text-emerald-400">
              {t.status === "LIVE" ? "● LIVE" : STATUS_LABELS[t.status] || t.status}
            </span>
            {t.liveScoringEnabled && t.status === "LIVE" && (
              <span className="flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-xs text-red-400">
                <Radio className="h-3 w-3" /> Live scores
              </span>
            )}
          </div>
          <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">{t.name}</h1>
          {t.description && <p className="mt-2 max-w-2xl text-zinc-400">{t.description}</p>}

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-300">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4 text-zinc-500" /> {fmtDate(t.startDate)}
              {t.endDate && <> – {fmtDate(t.endDate)}</>}
            </span>
            <span className="flex items-center gap-1.5">
              <Users className="h-4 w-4 text-zinc-500" /> {confirmed.length}/{t.totalTeams} teams
              {t.status === "REG_OPEN" && spotsLeft > 0 && (
                <span className="text-emerald-400">· {spotsLeft} spots left</span>
              )}
            </span>
            {t.feeMode !== "FREE" && (
              <span className="flex items-center gap-1.5">
                <IndianRupee className="h-4 w-4 text-zinc-500" /> ₹{t.entryFee.toLocaleString("en-IN")}/team
                {t.feeMode === "ADVANCE" && <span className="text-zinc-500">(₹{payable} online)</span>}
              </span>
            )}
          </div>

          {/* CTA */}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {myTeam ? (
              <span className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">
                ✓ Your team &quot;{myTeam.name}&quot; is {myTeam.status === "CONFIRMED" ? "confirmed" : myTeam.status === "WAITLISTED" ? "on the waitlist" : "awaiting payment"}
              </span>
            ) : canRegister ? (
              <Link
                href={`/tournaments/${t.slug}/register`}
                className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-500"
              >
                Register your team <ChevronRight className="h-4 w-4" />
              </Link>
            ) : t.status === "PUBLISHED" ? (
              <span className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-sm text-sky-300">
                Registrations opening soon
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Prizes */}
        {(t.prizePool || prizes.length > 0) && (
          <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-b from-amber-500/5 to-transparent p-5">
            <h2 className="flex items-center gap-2 font-semibold text-amber-400">
              <Trophy className="h-5 w-5" /> Prizes
            </h2>
            {t.prizePool ? (
              <p className="mt-2 text-2xl font-bold text-white">
                ₹{t.prizePool.toLocaleString("en-IN")}
                <span className="ml-1 text-sm font-normal text-zinc-500">total pool</span>
              </p>
            ) : null}
            <ul className="mt-3 space-y-2">
              {prizes.map((p) => (
                <li key={p.place} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-zinc-400">{p.place}</span>
                  <span className="text-right text-zinc-200">{p.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Format */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="font-semibold text-white">Format</h2>
          <p className="mt-2 text-sm text-zinc-400">
            {t.format === "POOLS_KNOCKOUT" ? (
              <>
                {t.poolCount} pools of {t.teamsPerPool} teams play round-robin. Top{" "}
                {t.advancePerPool} from each pool advance to the knockouts.
              </>
            ) : t.format === "LEAGUE" ? (
              <>All {t.totalTeams} teams play a round-robin league — top of the table wins.</>
            ) : (
              <>Straight knockout — lose and you&apos;re out. {t.totalTeams} teams, one champion.</>
            )}
          </p>
          <p className="mt-3 text-sm text-zinc-400">
            Squad size: {t.membersPerTeamMin}–{t.membersPerTeamMax} players.
          </p>
          {t.format !== "LEAGUE" && t.thirdPlaceMatch && (
            <p className="mt-1 text-sm text-zinc-500">Includes a 3rd-place match.</p>
          )}
        </div>

        {/* Teams */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="font-semibold text-white">
            Teams <span className="text-sm font-normal text-zinc-500">({confirmed.length})</span>
          </h2>
          {confirmed.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">Be the first team to register!</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {confirmed.map((team) => (
                <li key={team.id} className="flex items-center gap-2.5 text-sm text-zinc-200">
                  <span
                    className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: team.color || "#3f3f46" }}
                  >
                    {team.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={team.logoUrl} alt="" className="h-7 w-7 object-cover" />
                    ) : (
                      team.name.slice(0, 2).toUpperCase()
                    )}
                  </span>
                  {team.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Rules */}
      {t.rules && (
        <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="font-semibold text-white">Rules</h2>
          <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">{t.rules}</div>
        </div>
      )}
    </div>
  );
}
