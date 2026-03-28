import { adminAuth } from "@/lib/admin-auth-session";
import { redirect } from "next/navigation";
import { getBookingByQrToken } from "@/actions/checkin";
import { SPORT_INFO, formatHour } from "@/lib/court-config";
import { formatPrice } from "@/lib/pricing";
import { CheckinClient } from "./checkin-client";
import { CheckCircle2, XCircle, User, Calendar, Clock, MapPin } from "lucide-react";

export default async function CheckinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const session = await adminAuth();
  if (!session?.user) redirect("/godmode");

  const { token } = await searchParams;

  if (!token) {
    return (
      <div className="max-w-lg mx-auto text-center py-20">
        <div className="text-5xl mb-4">📲</div>
        <h1 className="text-2xl font-bold text-white mb-2">Check-in Scanner</h1>
        <p className="text-zinc-400">
          Scan a booking QR code to check in a guest, or open this page with a{" "}
          <code className="text-emerald-400 bg-zinc-800 px-1 rounded">?token=</code> parameter.
        </p>
      </div>
    );
  }

  const booking = await getBookingByQrToken(token);

  if (!booking) {
    return (
      <div className="max-w-lg mx-auto text-center py-20">
        <XCircle className="h-16 w-16 text-red-400 mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-white mb-2">Invalid QR Code</h1>
        <p className="text-zinc-400">This booking QR code is not valid or has expired.</p>
      </div>
    );
  }

  const sport = SPORT_INFO[booking.courtConfig.sport];
  const isConfirmed = booking.status === "CONFIRMED";
  const isCheckedIn = !!booking.checkedInAt;

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-white">Guest Check-in</h1>

      {/* Status */}
      {!isConfirmed && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 flex items-center gap-3">
          <XCircle className="h-5 w-5 text-red-400" />
          <p className="text-red-400 font-medium">
            Booking status: {booking.status} — cannot check in
          </p>
        </div>
      )}

      {isCheckedIn && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          <div>
            <p className="text-emerald-400 font-semibold">Already Checked In</p>
            <p className="text-sm text-zinc-400">
              {booking.checkedInAt?.toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          </div>
        </div>
      )}

      {/* Booking Details */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{sport.emoji}</span>
          <div>
            <p className="font-bold text-white text-lg">{sport.name}</p>
            <p className="text-zinc-400 text-sm">{booking.courtConfig.label}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2 text-zinc-300">
            <Calendar className="h-4 w-4 text-zinc-500" />
            {new Date(booking.date).toLocaleDateString("en-IN", { dateStyle: "medium" })}
          </div>
          <div className="flex items-center gap-2 text-zinc-300">
            <Clock className="h-4 w-4 text-zinc-500" />
            {formatHour(booking.slots[0]?.startHour)} –{" "}
            {formatHour((booking.slots[booking.slots.length - 1]?.startHour ?? 0) + 1)}
          </div>
          <div className="flex items-center gap-2 text-zinc-300">
            <User className="h-4 w-4 text-zinc-500" />
            {booking.user?.name || booking.user?.email || "Guest"}
          </div>
          <div className="flex items-center gap-2 text-zinc-300">
            <MapPin className="h-4 w-4 text-zinc-500" />
            {formatPrice(booking.totalAmount)}
          </div>
        </div>
      </div>

      {/* Check-in action */}
      {isConfirmed && !isCheckedIn && (
        <CheckinClient qrToken={token} bookingId={booking.id} />
      )}
    </div>
  );
}
