import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Clock, Users, IndianRupee } from "lucide-react";
import { areCampsEnabled, listPublicCamps } from "@/lib/camps";

export const dynamic = "force-dynamic";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const istDate = (d: Date) =>
  d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });

const hour = (h: number) => {
  const am = h < 12 || h === 24;
  const v = h % 12 === 0 ? 12 : h % 12;
  return `${v}${am ? "am" : "pm"}`;
};

export default async function CampsPage() {
  if (!(await areCampsEnabled())) notFound();
  const camps = await listPublicCamps();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white sm:text-4xl">Camps 🏕️</h1>
        <p className="mt-2 max-w-xl text-zinc-400">
          Structured coaching over a few weeks — fixed days, fixed times, a
          coach who knows your name. Register once and just turn up.
        </p>
      </div>

      {camps.length === 0 && (
        <p className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
          No camps are open right now. Check back soon.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {camps.map((c) => {
          const taken = c._count.registrations;
          const left = Math.max(0, c.capacity - taken);
          const open = c.status === "REGISTRATIONS_OPEN";
          return (
            <Link
              key={c.id}
              href={`/camps/${c.slug}`}
              className="group rounded-2xl border border-zinc-800 bg-zinc-900 p-5 transition-all hover:-translate-y-0.5 hover:border-emerald-500/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                    {c.sport}
                  </p>
                  <h2 className="mt-0.5 text-lg font-bold text-white">
                    {c.name}
                  </h2>
                </div>
                {!open && (
                  <span className="shrink-0 rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400">
                    {c.status === "ONGOING" ? "Running" : "Closed"}
                  </span>
                )}
              </div>

              {c.description && (
                <p className="mt-2 line-clamp-2 text-sm text-zinc-400">
                  {c.description}
                </p>
              )}

              <dl className="mt-4 space-y-1.5 text-sm text-zinc-300">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-zinc-500" />
                  {istDate(c.startDate)} – {istDate(c.endDate)}
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-zinc-500" />
                  {c.daysOfWeek.map((d) => DAYS[d]).join(", ")} ·{" "}
                  {hour(c.startHour)}–{hour(c.endHour)}
                </div>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-zinc-500" />
                  {left > 0 ? `${left} of ${c.capacity} spots left` : "Full"}
                  {c.ageMin || c.ageMax
                    ? ` · age ${c.ageMin ?? "any"}–${c.ageMax ?? "any"}`
                    : ""}
                </div>
                <div className="flex items-center gap-2 font-semibold text-emerald-400">
                  <IndianRupee className="h-4 w-4" />
                  {c.fee > 0 ? c.fee.toLocaleString("en-IN") : "Free"}
                  {c.feeMode === "ADVANCE" && c.fee > 0 && (
                    <span className="text-xs font-normal text-zinc-500">
                      ({c.advancePct}% to book)
                    </span>
                  )}
                </div>
              </dl>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
