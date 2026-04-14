"use client";

import Link from "next/link";
import {
  MdSportsCricket,
  MdSportsSoccer,
  MdSportsHandball,
  MdSportsTennis,
} from "react-icons/md";

const sportIcons: Record<string, React.ElementType> = {
  CRICKET: MdSportsCricket,
  FOOTBALL: MdSportsSoccer,
  PICKLEBALL: MdSportsTennis,
  BADMINTON: MdSportsHandball,
};

const sportColors: Record<string, string> = {
  CRICKET: "from-emerald-500/20 to-emerald-600/5 border-emerald-500/30 hover:border-emerald-400",
  FOOTBALL: "from-blue-500/20 to-blue-600/5 border-blue-500/30 hover:border-blue-400",
  PICKLEBALL: "from-yellow-500/20 to-yellow-600/5 border-yellow-500/30 hover:border-yellow-400",
  BADMINTON: "from-purple-500/20 to-purple-600/5 border-purple-500/30 hover:border-purple-400",
};

const sportIconColors: Record<string, string> = {
  CRICKET: "text-emerald-400",
  FOOTBALL: "text-blue-400",
  PICKLEBALL: "text-yellow-400",
  BADMINTON: "text-purple-400",
};

interface SportCardProps {
  sport: string;
  name: string;
  description: string;
  isActive: boolean;
}

export function SportCard({ sport, name, description, isActive }: SportCardProps) {
  const Icon = sportIcons[sport] || MdSportsCricket;
  const colorClass = sportColors[sport] || sportColors.CRICKET;
  const iconColor = sportIconColors[sport] || "text-emerald-400";

  const isComingSoon = sport === "PICKLEBALL" || sport === "BADMINTON";

  if (!isActive || isComingSoon) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 opacity-60 h-[100px] flex items-center">
        <div className="flex items-center gap-4">
          <div className="rounded-xl bg-zinc-800 p-3 shrink-0">
            <Icon className="h-8 w-8 text-zinc-500" />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-zinc-400">{name}</h3>
            <p className="text-sm text-zinc-600 line-clamp-1">
              {isComingSoon ? "Coming soon" : "Currently unavailable"}
            </p>
          </div>
        </div>
        {isComingSoon && (
          <span className="absolute right-3 top-3 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400 border border-amber-500/30">
            Coming Soon
          </span>
        )}
      </div>
    );
  }

  return (
    <Link href={`/book/${sport.toLowerCase()}`}>
      <div
        className={`group relative overflow-hidden rounded-2xl border bg-gradient-to-br ${colorClass} p-6 h-[100px] flex items-center transition-all duration-300 hover:scale-[1.02] hover:shadow-lg hover:shadow-black/20`}
      >
        <div className="flex items-center gap-4">
          <div className="rounded-xl bg-black/30 p-3 shrink-0 transition-transform duration-300 group-hover:scale-110">
            <Icon className={`h-8 w-8 ${iconColor}`} />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-white">{name}</h3>
          </div>
        </div>
        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600 transition-transform duration-300 group-hover:translate-x-1 group-hover:text-zinc-400">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  );
}
