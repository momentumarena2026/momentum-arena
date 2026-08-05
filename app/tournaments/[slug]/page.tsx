import Link from "next/link";
import { notFound } from "next/navigation";
import { Trophy, Users, IndianRupee, CalendarDays, Radio, ChevronRight, CalendarClock } from "lucide-react";
import { getMyTournamentTeam, getPublicTournamentBySlug } from "@/lib/tournaments";
import { onlinePayable, parsePrizes, STATUS_LABELS } from "@/lib/tournament-config";
import { auth } from "@/lib/auth";
import { SquadManager } from "./squad-manager";

export const dynamic = "force-dynamic";

const SPORT_LABEL: Record<string, string> = {
  CRICKET: "🏏 Cricket",
  FOOTBALL: "⚽ Football",
  PICKLEBALL: "🎾 Pickleball",
};

function fmtDate(d: Date | null): string {
  if (!d) return "TBA";
  // Venue wall-clock. Server components format in the server's zone (UTC
  // on Vercel) unless told otherwise, which shifted dates by 5:30.
  return new Date(d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
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
  const slots = t.slots ?? [];
  // 24h -> "10pm"; windows are venue wall-clock, never UTC.
  const hourLabel = (h: number) => {
    const hr = h % 24;
    const am = hr < 12;
    const v = hr % 12 === 0 ? 12 : hr % 12;
    return `${v}${am ? "am" : "pm"}`;
  };
  const myTeam = session?.user?.id
    ? t.teams.find((x) => x.captainUserId === session.user!.id)
    : null;
  const canRegister = t.status === "REG_OPEN" && !myTeam;
  // Squad is built AFTER registration — captains manage it right here.
  const mySquad = myTeam && session?.user?.id ? await getMyTournamentTeam(t.id, session.user.id) : null;

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
                {t.regOpenAt && new Date(t.regOpenAt) > new Date()
                  ? `Registrations open ${new Date(t.regOpenAt).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}`
                  : "Registrations opening soon"}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Captain's squad manager (post-registration, optional) */}
      {mySquad && (
        <SquadManager
          teamId={mySquad.id}
          members={mySquad.members}
          maxMembers={mySquad.maxMembers}
          canEdit={mySquad.canEditSquad}
        />
      )}

      {/* Tournament Center quick links */}
      {["REG_CLOSED", "POOLS_REVEALED", "LIVE", "COMPLETED", "REG_OPEN"].includes(t.status) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {t.format === "POOLS_KNOCKOUT" && (
            <Link href={`/tournaments/${t.slug}/reveal`} className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-2.5 text-sm text-violet-300 hover:bg-violet-500/20">
              ✨ Pool Reveal
            </Link>
          )}
          {t.format !== "KNOCKOUT" && (
            <Link href={`/tournaments/${t.slug}/table`} className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-800">
              📊 Points Table
            </Link>
          )}
          {t.format !== "LEAGUE" && (
            <Link href={`/tournaments/${t.slug}/bracket`} className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-800">
              🏆 Bracket
            </Link>
          )}
          <Link href={`/tournaments/${t.slug}/matches`} className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-800">
            📅 Matches
          </Link>
          <Link href={`/tournaments/${t.slug}/leaders`} className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-800">
            🥇 Leaderboards
          </Link>
        </div>
      )}

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

        {/* Pre-decided match windows */}
        {slots.length > 0 && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
            <h2 className="flex items-center gap-2 font-semibold text-white">
              <CalendarClock className="h-5 w-5 text-emerald-400" /> Match windows
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Pool matches run inside these windows. Semi-final and final are
              scheduled separately once the pools finish.
            </p>
            <ul className="mt-3 space-y-2">
              {slots.map((s) => (
                <li
                  key={s.id}
                  className="flex items-baseline justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm"
                >
                  <span className="text-zinc-300">
                    {new Date(s.date).toLocaleDateString("en-IN", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      timeZone: "Asia/Kolkata",
                    })}
                    {s.label ? (
                      <span className="ml-2 text-xs text-zinc-500">{s.label}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-medium text-emerald-300">
                    {hourLabel(s.startHour)} – {hourLabel(s.endHour)}
                  </span>
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
            Squad size: up to {t.membersPerTeamMax} players — add yours any time after registering.
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
