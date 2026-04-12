import { adminAuth } from "@/lib/admin-auth-session";
import { redirect } from "next/navigation";
import { getBookingByQrToken } from "@/actions/checkin";
import { SPORT_INFO, formatHour } from "@/lib/court-config";
import { formatPrice, formatBookingDate } from "@/lib/pricing";
import { CheckinClient } from "./checkin-client";
import { CheckCircle2, XCircle, User, Calendar, Clock, MapPin, IndianRupee } from "lucide-react";
import { ScannerWrapper } from "./scanner-wrapper";

const SPORT_EMOJI: Record<string, string> = {
  cricket: "\u{1F3CF}",
  football: "\u26BD",
  pickleball: "\u{1F3D3}",
  badminton: "\u{1F3F8}",
};

export default async function CheckinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const session = await adminAuth();
  if (!session?.user) redirect("/godmode");

  const { token } = await searchParams;

  // No token — show scanner
  if (!token) {
    return (
      <div className="max-w-lg mx-auto space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-1">Guest Check-in</h1>
          <p className="text-sm text-zinc-500">
            Scan a customer&apos;s booking QR code to check them in
          </p>
        </div>
        <ScannerWrapper />
      </div>
    );
  }

  // Token provided — look up booking
  const booking = await getBookingByQrToken(token);

  if (!booking) {
    return (
      <div className="max-w-lg mx-auto space-y-6">
        <div className="text-center py-10">
          <XCircle className="h-16 w-16 text-red-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Invalid QR Code</h1>
          <p className="text-zinc-400">This booking QR code is not valid or has expired.</p>
        </div>
        <ScannerWrapper />
      </div>
    );
  }

  const sport = SPORT_INFO[booking.courtConfig.sport];
  const emoji = SPORT_EMOJI[sport.icon] || "\u{1F3C3}";
  const isConfirmed = booking.status === "CONFIRMED";
  const isCheckedIn = !!booking.checkedInAt;

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-white">Guest Check-in</h1>

      {/* Status alerts */}
      {!isConfirmed && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 flex items-center gap-3">
          <XCircle className="h-5 w-5 text-red-400 shrink-0" />
          <p className="text-red-400 font-medium">
            Booking status: {booking.status} — cannot check in
          </p>
        </div>
      )}

      {isCheckedIn && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
          <div>
            <p className="text-emerald-400 font-semibold">Already Checked In</p>
            <p className="text-sm text-zinc-400">
              {booking.checkedInAt?.toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Asia/Kolkata",
              })}
            </p>
          </div>
        </div>
      )}

      {/* Booking Details */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{emoji}</span>
          <div>
            <p className="font-bold text-white text-lg">{sport.name}</p>
            <p className="text-zinc-400 text-sm">{booking.courtConfig.label}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2 text-zinc-300">
            <Calendar className="h-4 w-4 text-zinc-500" />
            {formatBookingDate(booking.date, { dateStyle: "medium" })}
          </div>
          <div className="flex items-center gap-2 text-zinc-300">
            <Clock className="h-4 w-4 text-zinc-500" />
            {formatHour(booking.slots[0]?.startHour)} –{" "}
            {formatHour((booking.slots[booking.slots.length - 1]?.startHour ?? 0) + 1)}
          </div>
          <div className="flex items-center gap-2 text-zinc-300">
            <User className="h-4 w-4 text-zinc-500" />
            {booking.user?.name || booking.user?.phone || "Guest"}
          </div>
          <div className="flex items-center gap-2 text-zinc-300">
            <IndianRupee className="h-4 w-4 text-zinc-500" />
            {formatPrice(booking.totalAmount)}
          </div>
        </div>

        {/* Payment info */}
        {booking.payment && (
          <div className="border-t border-zinc-800 pt-3 flex items-center justify-between text-sm">
            <span className="text-zinc-500">Payment</span>
            <span className={`font-medium ${
              booking.payment.status === "COMPLETED" ? "text-emerald-400" :
              booking.payment.status === "PENDING" ? "text-yellow-400" : "text-red-400"
            }`}>
              {booking.payment.status} via {booking.payment.method.replace("_", " ")}
            </span>
          </div>
        )}
      </div>

      {/* Check-in action */}
      {isConfirmed && !isCheckedIn && (
        <CheckinClient qrToken={token} bookingId={booking.id} />
      )}

      {/* Scan another */}
      <div className="border-t border-zinc-800 pt-4">
        <ScannerWrapper />
      </div>
    </div>
  );
}
