"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Radio, Trophy, MapPin, CalendarDays, Loader2 } from "lucide-react";
import type { MatchCentre } from "@/lib/tournament-scorecard";

// ESPNcricinfo-shaped match centre: a sticky result header, then tabs for
// the full scorecard, ball-by-ball commentary and match info. Polls while
// the match is live so the page updates itself.

const TABS = ["Scorecard", "Commentary", "Info"] as const;
type Tab = (typeof TABS)[number];

function Badge({
  team,
  size = 28,
}: {
  team: { name: string; color: string | null; logoUrl: string | null } | null;
  size?: number;
}) {
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white"
      style={{
        width: size,
        height: size,
        backgroundColor: team?.color || "#3f3f46",
        fontSize: size * 0.36,
      }}
    >
      {team?.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={team.logoUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        (team?.name || "?").slice(0, 2).toUpperCase()
      )}
    </span>
  );
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "Time TBA";
  return new Date(iso).toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

export function MatchCentreClient({ initial }: { initial: MatchCentre }) {
  const [data, setData] = useState<MatchCentre>(initial);
  const [tab, setTab] = useState<Tab>("Scorecard");
  const isLive = data.match.status === "LIVE";

  // Live matches refresh themselves; finished ones never change.
  useEffect(() => {
    if (!isLive) return;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/tournaments/match/${data.match.id}`, { cache: "no-store" });
        if (res.ok) setData(await res.json());
      } catch {
        /* transient */
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [isLive, data.match.id]);

  const m = data.match;
  const isCricket = m.sport === "CRICKET";

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <Link
        href={`/tournaments/${data.tournament.slug}/matches`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
      >
        <ChevronLeft className="h-4 w-4" /> All matches
      </Link>

      {/* ── Header card ── */}
      <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/70">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5 text-xs">
          <span className="text-zinc-400">
            {data.tournament.name} · {m.roundLabel || m.stage}
          </span>
          {isLive ? (
            <span className="flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 font-semibold text-red-400">
              <Radio className="h-3 w-3 animate-pulse" /> LIVE
            </span>
          ) : (
            <span className="rounded-full bg-zinc-800 px-2.5 py-1 text-zinc-400">
              {m.status === "COMPLETED" ? "Result" : m.status === "SCHEDULED" ? "Upcoming" : m.status}
            </span>
          )}
        </div>

        <div className="space-y-3 p-4">
          {[
            { team: m.homeTeam, score: m.homeScore, note: m.homeScoreNote },
            { team: m.awayTeam, score: m.awayScore, note: m.awayScoreNote },
          ].map((side, i) => {
            const won = m.winnerTeamId && side.team?.id === m.winnerTeamId;
            const innings = data.innings.find((inn) => inn.teamId === side.team?.id);
            return (
              <div key={i} className="flex items-center gap-3">
                <Badge team={side.team} size={36} />
                <span
                  className={`flex-1 truncate text-base ${won ? "font-bold text-white" : "text-zinc-300"}`}
                >
                  {side.team?.name || "TBD"}
                </span>
                <span className="text-right">
                  <span className={`text-xl font-bold ${won ? "text-emerald-400" : "text-zinc-200"}`}>
                    {side.note ||
                      (innings
                        ? `${innings.runs}/${innings.wickets}`
                        : side.score != null
                          ? side.score
                          : "—")}
                  </span>
                  {isCricket && innings && !side.note && (
                    <span className="ml-1.5 text-xs text-zinc-500">({innings.overs})</span>
                  )}
                </span>
              </div>
            );
          })}

          <div className="border-t border-zinc-800 pt-3 text-sm">
            <span className={isLive ? "text-amber-400" : "text-emerald-400"}>{m.resultText}</span>
            {m.playerOfMatch && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs text-zinc-400">
                <Trophy className="h-3 w-3 text-amber-400" /> POTM: {m.playerOfMatch}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="mt-4 flex gap-1 border-b border-zinc-800">
        {TABS.map((x) => (
          <button
            key={x}
            onClick={() => setTab(x)}
            className={`px-4 py-2.5 text-sm transition ${
              tab === x
                ? "border-b-2 border-emerald-500 font-medium text-white"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {x}
          </button>
        ))}
      </div>

      {/* ── Scorecard ── */}
      {tab === "Scorecard" && (
        <div className="mt-4 space-y-6">
          {isCricket && data.innings.length > 0
            ? data.innings.map((inn, i) => (
                <div key={i} className="overflow-hidden rounded-2xl border border-zinc-800">
                  <div className="flex items-baseline justify-between bg-zinc-900 px-4 py-3">
                    <h3 className="font-semibold text-white">{inn.teamName}</h3>
                    <span className="text-sm text-zinc-300">
                      <span className="text-lg font-bold text-emerald-400">
                        {inn.runs}/{inn.wickets}
                      </span>{" "}
                      ({inn.overs} ov, RR {inn.runRate})
                    </span>
                  </div>

                  {inn.batting.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[480px] text-sm">
                        <thead>
                          <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                            <th className="px-4 py-2 font-medium">Batting</th>
                            <th className="px-2 py-2 text-right font-medium">R</th>
                            <th className="px-2 py-2 text-right font-medium">B</th>
                            <th className="px-2 py-2 text-right font-medium">4s</th>
                            <th className="px-2 py-2 text-right font-medium">6s</th>
                            <th className="px-4 py-2 text-right font-medium">SR</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inn.batting.map((b) => (
                            <tr key={b.memberId} className="border-b border-zinc-800/60">
                              <td className="px-4 py-2">
                                <span className="text-zinc-100">{b.name}</span>
                                <span className="ml-2 text-xs text-zinc-500">
                                  {b.out ? b.dismissal || "out" : "not out"}
                                </span>
                              </td>
                              <td className="px-2 py-2 text-right font-semibold text-white">{b.runs}</td>
                              <td className="px-2 py-2 text-right text-zinc-400">{b.balls}</td>
                              <td className="px-2 py-2 text-right text-zinc-400">{b.fours}</td>
                              <td className="px-2 py-2 text-right text-zinc-400">{b.sixes}</td>
                              <td className="px-4 py-2 text-right text-zinc-400">{b.strikeRate}</td>
                            </tr>
                          ))}
                          <tr className="text-sm">
                            <td className="px-4 py-2 text-zinc-400">Extras</td>
                            <td className="px-2 py-2 text-right text-zinc-300" colSpan={5}>
                              {inn.extras}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="px-4 py-4 text-sm text-zinc-500">
                      Ball-by-ball player detail wasn&apos;t recorded for this innings.
                    </p>
                  )}

                  {inn.bowling.length > 0 && (
                    <div className="overflow-x-auto border-t border-zinc-800">
                      <table className="w-full min-w-[400px] text-sm">
                        <thead>
                          <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                            <th className="px-4 py-2 font-medium">Bowling</th>
                            <th className="px-2 py-2 text-right font-medium">O</th>
                            <th className="px-2 py-2 text-right font-medium">R</th>
                            <th className="px-2 py-2 text-right font-medium">W</th>
                            <th className="px-4 py-2 text-right font-medium">Econ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inn.bowling.map((b) => (
                            <tr key={b.memberId} className="border-b border-zinc-800/60">
                              <td className="px-4 py-2 text-zinc-100">{b.name}</td>
                              <td className="px-2 py-2 text-right text-zinc-400">{b.overs}</td>
                              <td className="px-2 py-2 text-right text-zinc-400">{b.runs}</td>
                              <td className="px-2 py-2 text-right font-semibold text-white">{b.wickets}</td>
                              <td className="px-4 py-2 text-right text-zinc-400">{b.economy}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {inn.fallOfWickets.length > 0 && (
                    <div className="border-t border-zinc-800 px-4 py-3 text-xs text-zinc-400">
                      <span className="text-zinc-500">Fall of wickets: </span>
                      {inn.fallOfWickets
                        .map((f) =>
                          f.batter
                            ? `${f.runs}-${f.wicket} (${f.batter}, ${f.over} ov)`
                            : `${f.runs}-${f.wicket} (${f.over} ov)`
                        )
                        .join(" · ")}
                    </div>
                  )}
                </div>
              ))
            : null}

          {/* Stat tables — non-cricket sports, and cricket matches whose
              result was entered by hand rather than scored ball-by-ball. */}
          {data.statTable.length > 0 && (!isCricket || data.innings.every((i) => i.batting.length === 0)) && (
            <div className="space-y-4">
              {data.statTable.map((t) => (
                <div key={t.teamId} className="overflow-hidden rounded-2xl border border-zinc-800">
                  <div className="bg-zinc-900 px-4 py-3 font-semibold text-white">{t.teamName}</div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[360px] text-sm">
                      <thead>
                        <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                          <th className="px-4 py-2 font-medium">Player</th>
                          {data.statFields.map((f) => (
                            <th key={f.key} className="px-4 py-2 text-right font-medium">
                              {f.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {t.rows.map((r, i) => (
                          <tr key={i} className="border-b border-zinc-800/60">
                            <td className="px-4 py-2 text-zinc-100">{r.name}</td>
                            {data.statFields.map((f) => (
                              <td key={f.key} className="px-4 py-2 text-right text-zinc-300">
                                {r.values[f.key] ?? 0}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}

          {data.innings.length === 0 && data.statTable.length === 0 && (
            <p className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 text-center text-sm text-zinc-500">
              {m.status === "SCHEDULED"
                ? "The scorecard appears once this match starts."
                : "No player detail was recorded for this match."}
            </p>
          )}
        </div>
      )}

      {/* ── Commentary ── */}
      {tab === "Commentary" && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60">
          {data.commentary.length === 0 ? (
            <p className="p-6 text-center text-sm text-zinc-500">No commentary yet.</p>
          ) : (
            <ul>
              {data.commentary.map((c) => (
                <li key={c.seq} className="flex gap-3 border-b border-zinc-800/60 px-4 py-3 last:border-0">
                  {c.over && (
                    <span className="w-10 shrink-0 font-mono text-xs text-zinc-500">{c.over}</span>
                  )}
                  <span
                    className={`flex-1 text-sm ${
                      c.wicket
                        ? "font-semibold text-red-400"
                        : c.boundary
                          ? "font-semibold text-emerald-400"
                          : "text-zinc-300"
                    }`}
                  >
                    {c.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {isLive && (
            <div className="flex items-center justify-center gap-2 border-t border-zinc-800 py-3 text-xs text-zinc-500">
              <Loader2 className="h-3 w-3 animate-spin text-emerald-500" /> Updating live
            </div>
          )}
        </div>
      )}

      {/* ── Info ── */}
      {tab === "Info" && (
        <div className="mt-4 space-y-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 text-sm">
          <p className="flex items-center gap-2 text-zinc-300">
            <CalendarDays className="h-4 w-4 text-zinc-500" /> {fmtWhen(m.scheduledAt)}
          </p>
          {m.venue && (
            <p className="flex items-center gap-2 text-zinc-300">
              <MapPin className="h-4 w-4 text-zinc-500" /> {m.venue}
            </p>
          )}
          <p className="text-zinc-400">
            {data.tournament.name} · {m.roundLabel || m.stage} · {m.sport}
          </p>
          {m.playerOfMatch && (
            <p className="flex items-center gap-2 text-amber-400">
              <Trophy className="h-4 w-4" /> Player of the Match: {m.playerOfMatch}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
