import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Bell, BellRing, Calendar, Clock, Trophy } from "lucide-react";
import { getUserWaitlist } from "@/actions/waitlist";
import { formatHourRangeCompact } from "@/lib/court-config";
import { formatBookingDate } from "@/lib/pricing";
import { BackButton } from "@/components/back-button";
import { WaitlistRowActions } from "./waitlist-row-actions";

export default async function WaitlistPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const result = await getUserWaitlist();
  const entries = result.success ? result.entries : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-3">
        <BackButton />
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <Bell className="h-6 w-6 text-amber-400" />
            My waitlist
          </h1>
          <p className="text-sm text-zinc-400">
            We&apos;ll alert you on push, SMS, and email the moment any of these
            slots opens up.
          </p>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900">
            <Bell className="h-6 w-6 text-zinc-500" />
          </div>
          <h2 className="text-base font-semibold text-white">
            You&apos;re not waiting for any slots yet
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            Tap any unavailable slot in the booking flow and we&apos;ll add it
            here. As soon as someone cancels, you&apos;ll get a push, SMS, and
            email so you can grab it first.
          </p>
          <Link
            href="/book"
            className="mt-5 inline-flex items-center justify-center rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Browse slots
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => {
            const courtLabel = entry.courtConfig.label;
            const dateLabel = formatBookingDate(entry.date, {
              weekday: "short",
              day: "numeric",
              month: "short",
            });
            const timeLabel =
              entry.endHour - entry.startHour === 1
                ? formatHourRangeCompact(entry.startHour)
                : `${formatHourRangeCompact(entry.startHour)} → ${formatHourRangeCompact(entry.endHour - 1)}`;
            const isNotified = entry.status === "NOTIFIED";

            return (
              <li
                key={entry.id}
                className={`rounded-2xl border p-4 ${
                  isNotified
                    ? "border-emerald-500/40 bg-emerald-500/5"
                    : "border-zinc-800 bg-zinc-950"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <Trophy className="h-4 w-4 text-amber-400" />
                      <span className="font-semibold text-white capitalize">
                        {entry.courtConfig.sport.toLowerCase().replace(/_/g, " ")}
                      </span>
                      <span className="text-zinc-500">·</span>
                      <span className="text-zinc-300">{courtLabel}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-400">
                      <span className="inline-flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" />
                        {dateLabel}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" />
                        {timeLabel}
                      </span>
                    </div>
                    {isNotified && (
                      <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
                        <BellRing className="h-3 w-3" />
                        Slot opened — book before someone else
                      </div>
                    )}
                  </div>
                  <WaitlistRowActions
                    waitlistId={entry.id}
                    courtConfigId={entry.courtConfig.id}
                    sport={entry.courtConfig.sport}
                    isNotified={isNotified}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
