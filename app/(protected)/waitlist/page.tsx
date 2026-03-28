import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUserWaitlist } from "@/actions/waitlist";
import { SPORT_INFO, formatHour } from "@/lib/court-config";
import { formatBookingDate } from "@/lib/pricing";
import Link from "next/link";
import { ArrowLeft, Bell, BellOff, Calendar, Clock } from "lucide-react";
import { WaitlistCancelButton } from "./waitlist-cancel-button";

export default async function WaitlistPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { entries } = await getUserWaitlist();

  const statusColors: Record<string, string> = {
    WAITING: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
    NOTIFIED: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  };

  const statusLabels: Record<string, string> = {
    WAITING: "Waiting",
    NOTIFIED: "Slot Available!",
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/dashboard"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-white">My Waitlist</h1>
        <p className="mt-1 text-zinc-400">
          {entries && entries.length > 0
            ? `${entries.length} active waitlist entr${entries.length !== 1 ? "ies" : "y"}`
            : "Track slots you're waiting for"}
        </p>
      </div>

      {!entries || entries.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center">
          <BellOff className="mx-auto h-12 w-12 text-zinc-600" />
          <p className="mt-3 text-zinc-400">You&apos;re not on any waitlists</p>
          <p className="mt-1 text-sm text-zinc-500">
            When a slot is fully booked, you can join the waitlist and get notified when it opens up.
          </p>
          <Link
            href="/book"
            className="mt-4 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Browse Courts
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => {
            const sportInfo = SPORT_INFO[entry.courtConfig.sport];
            const statusColor = statusColors[entry.status] || "text-zinc-400 bg-zinc-800 border-zinc-700";
            const statusLabel = statusLabels[entry.status] || entry.status;

            return (
              <div
                key={entry.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-lg bg-zinc-800 p-2">
                      <Bell className="h-4 w-4 text-zinc-400" />
                    </div>
                    <div>
                      <p className="font-medium text-white">
                        {sportInfo.name} — {entry.courtConfig.label}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatBookingDate(entry.date, {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                          })}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatHour(entry.startHour)} – {formatHour(entry.endHour)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusColor}`}>
                      {statusLabel}
                    </span>
                    <WaitlistCancelButton waitlistId={entry.id} />
                  </div>
                </div>

                {entry.status === "NOTIFIED" && (
                  <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                    <p className="text-xs text-emerald-400">
                      A slot has opened! Book it now before it&apos;s taken.
                    </p>
                    <Link
                      href="/book"
                      className="mt-1 inline-block text-xs font-medium text-emerald-400 underline underline-offset-2 hover:text-emerald-300"
                    >
                      Book now →
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
