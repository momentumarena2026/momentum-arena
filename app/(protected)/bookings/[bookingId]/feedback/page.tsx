import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect, notFound } from "next/navigation";
import { SPORT_INFO, formatHour } from "@/lib/court-config";
import { FeedbackForm } from "./feedback-form";
import { Star } from "lucide-react";
import Link from "next/link";

export default async function FeedbackPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { bookingId } = await params;

  const booking = await db.booking.findUnique({
    where: { id: bookingId, userId: session.user.id, status: "CONFIRMED" },
    include: {
      courtConfig: true,
      slots: { orderBy: { startHour: "asc" } },
      feedback: true,
    },
  });

  if (!booking) notFound();

  const sport = SPORT_INFO[booking.courtConfig.sport];

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <Link href="/bookings" className="text-sm text-zinc-400 hover:text-white transition-colors">
          ← Back to Bookings
        </Link>
      </div>

      {/* Booking summary */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 flex items-center gap-3">
        <span className="text-3xl">{sport.emoji}</span>
        <div>
          <p className="font-bold text-white">{sport.name} — {booking.courtConfig.label}</p>
          <p className="text-sm text-zinc-400">
            {new Date(booking.date).toLocaleDateString("en-IN", { dateStyle: "medium" })} •{" "}
            {formatHour(booking.slots[0]?.startHour)} –{" "}
            {formatHour((booking.slots[booking.slots.length - 1]?.startHour ?? 0) + 1)}
          </p>
        </div>
      </div>

      {booking.feedback ? (
        /* Already submitted */
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center space-y-3">
          <div className="text-4xl">✅</div>
          <h2 className="text-xl font-bold text-white">Feedback Already Submitted</h2>
          <div className="flex justify-center gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={`h-6 w-6 ${
                  i < (booking.feedback?.rating ?? 0)
                    ? "text-yellow-400 fill-yellow-400"
                    : "text-zinc-600"
                }`}
              />
            ))}
          </div>
          {booking.feedback.comment && (
            <p className="text-zinc-400 text-sm italic">"{booking.feedback.comment}"</p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-2">
          <h1 className="text-xl font-bold text-white">Rate Your Session</h1>
          <p className="text-sm text-zinc-400">
            How was your experience at Momentum Arena?
          </p>
          <div className="pt-4">
            <FeedbackForm bookingId={bookingId} />
          </div>
        </div>
      )}
    </div>
  );
}
