"use client";

import {
  CalendarDays,
  Clock,
  Trophy,
  IndianRupee,
  Star,
} from "lucide-react";
import { Sport } from "@prisma/client";

interface ProfileStatsProps {
  totalBookings: number;
  totalHours: number;
  favouriteSport: Sport | null;
  totalSpentPaise: number;
  memberSince: Date;
}

const SPORT_EMOJI: Record<Sport, string> = {
  CRICKET: "🏏",
  FOOTBALL: "⚽",
  BADMINTON: "🏸",
  PICKLEBALL: "🎾",
};

const SPORT_LABEL: Record<Sport, string> = {
  CRICKET: "Cricket",
  FOOTBALL: "Football",
  BADMINTON: "Badminton",
  PICKLEBALL: "Pickleball",
};

function getMembershipTier(totalBookings: number): {
  label: string;
  color: string;
} {
  if (totalBookings >= 50)
    return { label: "Platinum", color: "text-purple-400 border-purple-500/30 bg-purple-500/10" };
  if (totalBookings >= 20)
    return { label: "Gold", color: "text-yellow-400 border-yellow-500/30 bg-yellow-500/10" };
  if (totalBookings >= 5)
    return { label: "Silver", color: "text-zinc-300 border-zinc-400/30 bg-zinc-400/10" };
  return { label: "Bronze", color: "text-amber-500 border-amber-600/30 bg-amber-600/10" };
}

export function ProfileStats({
  totalBookings,
  totalHours,
  favouriteSport,
  totalSpentPaise,
  memberSince,
}: ProfileStatsProps) {
  const tier = getMembershipTier(totalBookings);
  const memberSinceStr = memberSince.toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
  });
  const totalSpentStr = `₹${(totalSpentPaise / 100).toLocaleString("en-IN")}`;

  const stats = [
    {
      icon: CalendarDays,
      label: "Total Bookings",
      value: totalBookings.toString(),
      iconColor: "text-emerald-400",
    },
    {
      icon: Clock,
      label: "Hours Played",
      value: `${totalHours}h`,
      iconColor: "text-blue-400",
    },
    {
      icon: Trophy,
      label: "Favourite Sport",
      value: favouriteSport
        ? `${SPORT_EMOJI[favouriteSport]} ${SPORT_LABEL[favouriteSport]}`
        : "—",
      iconColor: "text-yellow-400",
    },
    {
      icon: IndianRupee,
      label: "Total Spent",
      value: totalSpentStr,
      iconColor: "text-purple-400",
    },
    {
      icon: CalendarDays,
      label: "Member Since",
      value: memberSinceStr,
      iconColor: "text-zinc-400",
    },
    {
      icon: Star,
      label: "Tier",
      value: (
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tier.color}`}
        >
          {tier.label}
        </span>
      ),
      iconColor: "text-amber-400",
    },
  ];

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
      <h3 className="text-sm font-medium text-zinc-500 uppercase tracking-wider">
        Your Stats
      </h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map(({ icon: Icon, label, value, iconColor }) => (
          <div
            key={label}
            className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 space-y-2"
          >
            <div className="flex items-center gap-1.5">
              <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
              <span className="text-[11px] text-zinc-500 truncate">{label}</span>
            </div>
            <div className="text-sm font-semibold text-white leading-tight">
              {value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
