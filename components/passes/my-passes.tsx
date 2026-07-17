"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Sparkles, Archive } from "lucide-react";
import {
  MdSportsCricket,
  MdSportsSoccer,
  MdSportsTennis,
} from "react-icons/md";
import { GiCricketBat } from "react-icons/gi";
import type { IconType } from "react-icons";
import { PassClock } from "./pass-clock";

export interface MyPass {
  id: string;
  name: string;
  sport: string;
  totalMinutes: number;
  remainingMinutes: number;
  bandsSummary: string;
  startsAt: string;
  expiresAt: string;
  status: string;
  /** "owner" bought it; "member" was added to someone else's pass. */
  role: "owner" | "member";
  ownerName: string | null;
}

const SPORT_ICON: Record<string, IconType> = {
  CRICKET: MdSportsCricket,
  FOOTBALL: MdSportsSoccer,
  PICKLEBALL: MdSportsTennis,
};
const SPORT_ACCENT: Record<string, string> = {
  CRICKET: "#34d399",
  FOOTBALL: "#60a5fa",
  PICKLEBALL: "#facc15",
};
const USED_COLOR = "#52525b";

const fmtH = (m: number) => `${(m / 60).toFixed(1).replace(/\.0$/, "")}h`;
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  UPCOMING: "Upcoming",
  EXHAUSTED: "Used up",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

const KEYFRAMES = `
@keyframes mp-ring { 0%,100% { transform: scale(1); opacity:.5 } 50% { transform: scale(1.14); opacity:0 } }
@keyframes mp-spin { to { transform: rotate(360deg) } }
@keyframes mp-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-9px) } }
@keyframes mp-shimmer { to { background-position: 200% center } }
@keyframes mp-rise { from { opacity:0; transform: translateY(14px) } to { opacity:1; transform: translateY(0) } }
`;

/** ACTIVE + UPCOMING are "live"; everything else (cancelled, used up,
 *  expired) files under the Inactive tab with its specific status. */
const isLive = (status: string) => status === "ACTIVE" || status === "UPCOMING";

/**
 * "Your passes" surface with Active / Inactive tabs. Each owned pass is
 * a ticket with an animated clock (used vs remaining) that replays on
 * hover / tap. An empty Active tab shows the glowing storefront invite;
 * an empty Inactive tab a quiet note.
 */
export function MyPasses({
  passes,
  standalone = false,
}: {
  passes: MyPass[];
  /** true on the dedicated /my-passes page, where the page renders its
   *  own title + Buy-more affordance — hides the section header row. */
  standalone?: boolean;
}) {
  const [tab, setTab] = useState<"active" | "inactive">("active");
  const activePasses = passes.filter((p) => isLive(p.status));
  const inactivePasses = passes.filter((p) => !isLive(p.status));
  const shown = tab === "active" ? activePasses : inactivePasses;

  const tabBtn = (key: "active" | "inactive", label: string, count: number) => (
    <button
      onClick={() => setTab(key)}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
        tab === key
          ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
          : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
          tab === key ? "bg-emerald-500/20 text-emerald-300" : "bg-zinc-800 text-zinc-500"
        }`}
      >
        {count}
      </span>
    </button>
  );

  return (
    <section>
      <style>{KEYFRAMES}</style>
      {!standalone && (
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Your passes</h2>
          <Link
            href="/passes"
            className="inline-flex items-center gap-1 text-sm font-medium text-emerald-400 hover:text-emerald-300"
          >
            Buy more <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4 flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-1 w-fit">
        {tabBtn("active", "Active", activePasses.length)}
        {tabBtn("inactive", "Inactive", inactivePasses.length)}
      </div>

      {shown.length === 0 ? (
        tab === "active" ? (
          <EmptyPasses />
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/40 px-6 py-10 text-center">
            <Archive className="h-8 w-8 text-zinc-600" />
            <p className="text-sm font-medium text-zinc-300">
              No inactive passes
            </p>
            <p className="max-w-xs text-xs text-zinc-500">
              Passes you cancel, use up, or let expire will be archived here.
            </p>
          </div>
        )
      ) : (
        <>
          <p className="mb-3 -mt-1 text-xs text-zinc-500">
            Hover (or tap) a pass to replay its balance ring.
          </p>
          <div key={tab} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((p) => {
          const accent = SPORT_ACCENT[p.sport] ?? "#34d399";
          const Icon =
            p.sport === "CRICKET" && p.bandsSummary === "All hours"
              ? GiCricketBat
              : SPORT_ICON[p.sport] ?? MdSportsCricket;
          const total = p.totalMinutes / 60;
          const remaining = p.remainingMinutes / 60;
          const inactive = p.status !== "ACTIVE" && p.status !== "UPCOMING";
          return (
            <Link
              key={p.id}
              href={`/passes/${p.id}`}
              className={`group relative block overflow-hidden rounded-2xl border bg-zinc-900 transition-all hover:-translate-y-0.5 ${
                inactive
                  ? "border-zinc-800 opacity-75"
                  : "border-zinc-800 hover:shadow-xl"
              }`}
              style={{ boxShadow: inactive ? undefined : `0 0 0 1px ${accent}12` }}
            >
              {/* Ticket header band */}
              <div
                className="flex items-start justify-between px-4 pt-4"
                style={{
                  background: inactive
                    ? undefined
                    : `linear-gradient(135deg, ${accent}1f, transparent 70%)`,
                }}
              >
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${accent}1f` }}
                >
                  <Icon size={22} color={inactive ? "#a1a1aa" : accent} />
                </span>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                  style={{
                    backgroundColor: inactive ? "#27272a" : `${accent}22`,
                    color: inactive ? "#a1a1aa" : accent,
                  }}
                >
                  {STATUS_LABEL[p.status] ?? p.status}
                </span>
              </div>

              <p className="px-4 pt-2 text-sm font-semibold leading-snug text-white">
                {p.name}
              </p>

              {/* Perforation */}
              <div className="relative mt-3">
                <div className="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-black" />
                <div className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-black" />
                <div className="border-t border-dashed border-zinc-700" />
              </div>

              {/* Clock */}
              <div className="flex flex-col items-center px-4 py-5">
                <PassClock
                  totalHours={total}
                  remainingHours={remaining}
                  accent={accent}
                  size={132}
                  trigger="mount"
                  replayOnInteract
                  usedColor={USED_COLOR}
                  dim={inactive}
                />

                {/* Legend — the used vs remaining split, spelled out */}
                <div className="mt-4 flex items-center gap-4 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: inactive ? USED_COLOR : accent }}
                    />
                    <span className="text-zinc-300">{fmtH(p.remainingMinutes)} left</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: USED_COLOR }}
                    />
                    <span className="text-zinc-500">
                      {fmtH(p.totalMinutes - p.remainingMinutes)} used
                    </span>
                  </span>
                </div>
              </div>

              <div className="border-t border-zinc-800/70 px-4 py-2.5 text-[11px] text-zinc-500">
                {p.status === "UPCOMING" ? (
                  <span className="text-amber-300">
                    Starts {fmtDate(p.startsAt)}
                  </span>
                ) : (
                  <>Expires {fmtDate(p.expiresAt)}</>
                )}
                {p.bandsSummary && p.bandsSummary !== "All hours" && (
                  <span> · {p.bandsSummary}</span>
                )}
                {p.role === "member" && (
                  <span className="text-sky-300">
                    {" "}
                    · Shared by {p.ownerName ?? "the owner"}
                  </span>
                )}
              </div>
            </Link>
          );
            })}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * No passes yet — a glowing, animated invitation. Pulsing rings behind a
 * slowly-rotating dashed clock ring with a ticket at the centre, floating
 * sport glyphs, a shimmering headline, and a CTA to the storefront.
 */
function EmptyPasses() {
  return (
    <div>
      <div
        className="relative overflow-hidden rounded-3xl border border-emerald-500/20 bg-gradient-to-b from-emerald-950/40 via-zinc-950 to-black px-6 py-14 text-center"
        style={{ animation: "mp-rise 500ms ease-out both" }}
      >
        {/* Ambient glow */}
        <div className="pointer-events-none absolute inset-0 opacity-70">
          <div className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/10 blur-3xl" />
        </div>

        {/* Floating sport glyphs */}
        <MdSportsCricket
          className="absolute left-[14%] top-[22%] text-emerald-400/25"
          size={30}
          style={{ animation: "mp-float 5s ease-in-out infinite" }}
        />
        <MdSportsSoccer
          className="absolute right-[15%] top-[30%] text-blue-400/25"
          size={30}
          style={{ animation: "mp-float 6s ease-in-out infinite 0.8s" }}
        />
        <MdSportsTennis
          className="absolute bottom-[20%] left-[20%] text-yellow-400/25"
          size={26}
          style={{ animation: "mp-float 5.5s ease-in-out infinite 1.4s" }}
        />

        {/* Animated clock emblem */}
        <div className="relative mx-auto mb-6 flex h-32 w-32 items-center justify-center">
          <span
            className="absolute inset-0 rounded-full border border-emerald-400/40"
            style={{ animation: "mp-ring 2.8s ease-out infinite" }}
          />
          <span
            className="absolute inset-0 rounded-full border border-emerald-400/40"
            style={{ animation: "mp-ring 2.8s ease-out infinite 1.4s" }}
          />
          <svg
            viewBox="0 0 100 100"
            className="absolute inset-0 h-full w-full"
            style={{ animation: "mp-spin 14s linear infinite" }}
          >
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke="#34d399"
              strokeWidth="2"
              strokeDasharray="4 8"
              strokeLinecap="round"
              opacity="0.6"
            />
          </svg>
          <span className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-500/15 text-4xl ring-1 ring-emerald-400/30">
            🎟️
          </span>
        </div>

        <h2
          className="bg-[linear-gradient(100deg,#fff,#6ee7b7,#fff)] bg-[length:200%_auto] bg-clip-text text-2xl font-bold text-transparent sm:text-3xl"
          style={{ animation: "mp-shimmer 4s linear infinite" }}
        >
          Your passes will live here
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-zinc-400">
          Buy hours in bulk at a lower per-hour rate, then let your pass pay at
          checkout instead of your wallet. Watch your balance tick down like a
          clock as you play.
        </p>

        <Link
          href="/passes"
          className="mt-7 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-emerald-950 shadow-lg shadow-emerald-500/25 transition-transform hover:scale-[1.03]"
        >
          <Sparkles className="h-4 w-4" />
          Explore passes
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
