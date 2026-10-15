"use client";

import Link from "next/link";
import {
  MdSportsCricket,
  MdSportsSoccer,
  MdSportsTennis,
} from "react-icons/md";
import { FaTableTennisPaddleBall } from "react-icons/fa6";
import type { Sport } from "@prisma/client";
import { sportSlug } from "@/lib/court-config";
import { trackSportSelected } from "@/lib/analytics";

// Record<Sport, …>, NOT Record<string, …>.
//
// All three of these were keyed on `string` with a `|| CRICKET`
// fallback, so adding a sport compiled cleanly and the new card simply
// came out green, wearing a cricket bat, on /book. Nothing reported it
// — it looked like a styling choice. Keyed on the enum, the compiler
// refuses to build until the next sport has an icon and a colour.
const sportIcons: Record<Sport, React.ElementType> = {
  CRICKET: MdSportsCricket,
  FOOTBALL: MdSportsSoccer,
  PICKLEBALL: MdSportsTennis,
  TABLE_TENNIS: FaTableTennisPaddleBall,
};

const sportColors: Record<Sport, string> = {
  CRICKET: "from-emerald-500/20 to-emerald-600/5 border-emerald-500/30 hover:border-emerald-400",
  FOOTBALL: "from-blue-500/20 to-blue-600/5 border-blue-500/30 hover:border-blue-400",
  PICKLEBALL: "from-yellow-500/20 to-yellow-600/5 border-yellow-500/30 hover:border-yellow-400",
  TABLE_TENNIS: "from-rose-500/20 to-rose-600/5 border-rose-500/30 hover:border-rose-400",
};

const sportIconColors: Record<Sport, string> = {
  CRICKET: "text-emerald-400",
  FOOTBALL: "text-blue-400",
  PICKLEBALL: "text-yellow-400",
  TABLE_TENNIS: "text-rose-400",
};

interface SportCardProps {
  sport: string;
  name: string;
  description: string;
  isActive: boolean;
}

export function SportCard({ sport, name, description, isActive }: SportCardProps) {
  const key = sport as Sport;
  const Icon = sportIcons[key] ?? MdSportsCricket;
  const colorClass = sportColors[key] ?? sportColors.CRICKET;
  const iconColor = sportIconColors[key] ?? "text-emerald-400";

  if (!isActive) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 opacity-60 h-[100px] flex items-center">
        <div className="flex items-center gap-4">
          <div className="rounded-xl bg-zinc-800 p-3 shrink-0">
            <Icon className="h-8 w-8 text-zinc-500" />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-zinc-400">{name}</h3>
          </div>
        </div>
      </div>
    );
  }

  // sportSlug, not toLowerCase(): that produced /book/table_tennis,
  // which resolves but is NOT the canonical URL in the sitemap. An
  // internal link to the non-canonical form is exactly what splits a
  // page's ranking between two URLs.
  return (
    <Link href={`/book/${sportSlug(sport)}`} onClick={() => trackSportSelected(sport)}>
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
