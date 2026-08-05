import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Clock, Users, IndianRupee } from "lucide-react";
import { areCampsEnabled, listPublicCamps } from "@/lib/camps";
import { sportTheme } from "@/lib/sport-theme";

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
        <h1 className="text-3xl font-bold text-white sm:text-4xl">
          Camps <span className="text-emerald-400">🏕️</span>
        </h1>
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
          const t = sportTheme(c.sport);
          return (
            <Link
              key={c.id}
              href={`/camps/${c.slug}`}
              className={`group overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 transition-all hover:-translate-y-0.5 hover:shadow-xl ${t.ring}`}
            >
              {/* Banner: the admin's uploaded image when there is one,
                  otherwise the sport's own photo — a camp card should
                  never be a wall of text. */}
              <div className="relative h-36 w-full overflow-hidden">
                <Image
                  src={c.bannerImageUrl || t.image}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 100vw, 50vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div
                  className={`absolute inset-0 bg-gradient-to-t ${t.gradient}`}
                />
                <div className="absolute inset-x-0 bottom-0 p-4">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${t.chip}`}
                    >
                      {t.emoji} {t.label}
                    </span>
                    {!open && (
                      <span className="rounded-full border border-zinc-600 bg-zinc-950/70 px-2 py-0.5 text-[10px] uppercase tracking-wider text-zinc-300">
                        {c.status === "ONGOING" ? "Running" : "Closed"}
                      </span>
                    )}
                    {open && left > 0 && left <= 5 && (
                      <span className="rounded-full border border-red-500/40 bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-300">
                        {left} left
                      </span>
                    )}
                  </div>
                  <h2 className="mt-1.5 text-lg font-bold text-white drop-shadow-sm">
                    {c.name}
                  </h2>
                </div>
              </div>

              <div className="p-5">
                {c.description && (
                  <p className="line-clamp-2 text-sm text-zinc-400">
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
                </dl>

                {/* Capacity bar — "12 of 40 left" is easier to feel than read. */}
                <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, Math.round((taken / Math.max(1, c.capacity)) * 100))}%`,
                      backgroundColor: t.hex,
                    }}
                  />
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-zinc-800 pt-3">
                  <span className="flex items-center gap-1 text-lg font-bold text-white">
                    <IndianRupee className="h-4 w-4 text-zinc-400" />
                    {c.fee > 0 ? c.fee.toLocaleString("en-IN") : "Free"}
                    {c.feeMode === "ADVANCE" && c.fee > 0 && (
                      <span className="ml-1 text-xs font-normal text-zinc-500">
                        ({c.advancePct}% to book)
                      </span>
                    )}
                  </span>
                  <span
                    className={`text-sm font-semibold ${t.text} transition-transform group-hover:translate-x-0.5`}
                  >
                    {open ? "Register →" : "View →"}
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
