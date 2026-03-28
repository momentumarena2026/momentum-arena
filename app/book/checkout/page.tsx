import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect, notFound } from "next/navigation";
import { SPORT_INFO, SIZE_INFO, formatHour } from "@/lib/court-config";
import { formatPrice } from "@/lib/pricing";
import { getActiveBanners } from "@/actions/admin-banners";
import { getNewUserDiscount } from "@/lib/new-user-discount";
import { PromoBanners } from "@/components/booking/promo-banners";
import { CheckoutClient } from "./checkout-client";

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ bookingId?: string; recurring?: string; weeksCount?: string; dayOfWeek?: string; startDate?: string; startHour?: string; endHour?: string; courtConfigId?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/book?error=login_required");

  const params = await searchParams;
  const { bookingId } = params;
  if (!bookingId) redirect("/book");

  const booking = await db.booking.findUnique({
    where: { id: bookingId, userId: session.user.id },
    include: {
      courtConfig: true,
      slots: { orderBy: { startHour: "asc" } },
    },
  });

  if (!booking) notFound();

  if (booking.status === "LOCKED" && booking.lockExpiresAt && booking.lockExpiresAt < new Date()) {
    redirect("/book?error=lock_expired");
  }

  if (booking.status !== "LOCKED") {
    redirect(`/book/confirmation/${bookingId}`);
  }

  const sportInfo = SPORT_INFO[booking.courtConfig.sport];
  const sizeInfo = SIZE_INFO[booking.courtConfig.size];

  // Extract slot info for equipment
  const slotStartHour = booking.slots.length > 0 ? Math.min(...booking.slots.map((s) => s.startHour)) : undefined;
  const slotEndHour = booking.slots.length > 0 ? Math.max(...booking.slots.map((s) => s.startHour)) + 1 : undefined;
  const bookingDateStr = booking.date.toISOString().split("T")[0];

  // Parse recurring params
  const recurringEnabled = params.recurring === "1";
  const recurringWeeksCount = params.weeksCount ? parseInt(params.weeksCount) : undefined;
  const recurringDayOfWeek = params.dayOfWeek !== undefined ? parseInt(params.dayOfWeek) : undefined;
  const recurringStartDate = params.startDate;
  const recurringStartHour = params.startHour !== undefined ? parseInt(params.startHour) : undefined;
  const recurringEndHour = params.endHour !== undefined ? parseInt(params.endHour) : undefined;
  const recurringCourtConfigId = params.courtConfigId;

  // Fetch banners and new user discount in parallel
  const [banners, newUserDiscount] = await Promise.all([
    getActiveBanners("CHECKOUT").catch(() => []),
    getNewUserDiscount(session.user.id, booking.courtConfig.sport, booking.totalAmount).catch(() => null),
  ]);

  // Find razorpay offer from active banners
  const razorpayOfferId = banners.find((b) => b.razorpayOfferId)?.razorpayOfferId || undefined;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-white">Complete Payment</h1>

      {/* Promo Banners */}
      <PromoBanners
        banners={banners.map((b) => ({
          id: b.id,
          title: b.title,
          description: b.description,
          discountInfo: b.discountInfo,
        }))}
      />

      {/* Booking Summary */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-white">Booking Summary</h2>
          <span className="rounded-full bg-yellow-500/10 border border-yellow-500/30 px-2 py-0.5 text-xs text-yellow-400">
            Locked
          </span>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-400">Sport</span>
            <span className="text-white">{sportInfo.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Court</span>
            <span className="text-white">{booking.courtConfig.label} ({sizeInfo.name})</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Date</span>
            <span className="text-white">
              {booking.date.toLocaleDateString("en-IN", {
                weekday: "short",
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Slots</span>
            <span className="text-white">
              {booking.slots.map((s) => formatHour(s.startHour)).join(", ")}
            </span>
          </div>
          {recurringEnabled && recurringWeeksCount && (
            <div className="flex justify-between">
              <span className="text-zinc-400">Recurring</span>
              <span className="text-emerald-400">Every week {"\u00D7"} {recurringWeeksCount} weeks</span>
            </div>
          )}
        </div>

        <div className="border-t border-zinc-800 pt-3">
          {booking.slots.map((slot) => (
            <div key={slot.id} className="flex justify-between text-sm">
              <span className="text-zinc-500">{formatHour(slot.startHour)}</span>
              <span className="text-zinc-300">{formatPrice(slot.price)}</span>
            </div>
          ))}
          <div className="mt-2 flex justify-between border-t border-zinc-800 pt-2">
            <span className="font-semibold text-white">Total</span>
            <span className="text-lg font-bold text-emerald-400">
              {formatPrice(booking.totalAmount)}
            </span>
          </div>
        </div>
      </div>

      {/* Payment */}
      <CheckoutClient
        bookingId={bookingId}
        amount={booking.totalAmount}
        sport={booking.courtConfig.sport}
        lockExpiresAt={booking.lockExpiresAt!.toISOString()}
        userName={session.user.name || ""}
        userEmail={session.user.email || ""}
        userPhone={(session.user as { phone?: string }).phone || ""}
        razorpayOfferId={razorpayOfferId}
        newUserDiscount={
          newUserDiscount
            ? {
                code: newUserDiscount.code,
                discountAmount: newUserDiscount.discountAmount,
                label: newUserDiscount.type === "PERCENTAGE"
                  ? `${newUserDiscount.value / 100}% off`
                  : formatPrice(newUserDiscount.value),
              }
            : undefined
        }
        bookingDate={bookingDateStr}
        startHour={slotStartHour}
        endHour={slotEndHour}
        recurringEnabled={recurringEnabled}
        recurringWeeksCount={recurringWeeksCount}
        recurringDayOfWeek={recurringDayOfWeek}
        recurringStartDate={recurringStartDate}
        recurringStartHour={recurringStartHour}
        recurringEndHour={recurringEndHour}
        recurringCourtConfigId={recurringCourtConfigId}
      />
    </div>
  );
}
