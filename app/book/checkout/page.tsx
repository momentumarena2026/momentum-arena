import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect, notFound } from "next/navigation";
import { SPORT_INFO, SIZE_INFO, formatHourRangeCompact, formatHoursAsRanges, customerFacingCourtLabel } from "@/lib/court-config";
import { formatPrice, formatBookingDate } from "@/lib/pricing";
import { getNewUserDiscount } from "@/lib/new-user-discount";
import { getCheckoutPaymentConfig } from "@/actions/admin-payment-settings";
import { CheckoutClient } from "./checkout-client";

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{
    holdId?: string;
    recurring?: string;
    mode?: string;
    weeksCount?: string;
    daysCount?: string;
    dayOfWeek?: string;
    startDate?: string;
    startHour?: string;
    endHour?: string;
    courtConfigId?: string;
    discountPercent?: string;
  }>;
}) {
  const params = await searchParams;
  const session = await auth();
  if (!session?.user?.id) {
    const checkoutUrl = `/book/checkout?${new URLSearchParams(params as Record<string, string>).toString()}`;
    redirect(`/login?callbackUrl=${encodeURIComponent(checkoutUrl)}`);
  }

  const { holdId } = params;
  if (!holdId) redirect("/book");

  const hold = await db.slotHold.findUnique({
    where: { id: holdId },
    include: { courtConfig: true },
  });

  if (!hold || hold.userId !== session.user.id) notFound();

  if (hold.expiresAt < new Date()) {
    redirect("/book?error=lock_expired");
  }

  const sportInfo = SPORT_INFO[hold.courtConfig.sport];
  const sizeInfo = SIZE_INFO[hold.courtConfig.size];
  void sizeInfo;

  // Sort hours for display
  const slotPrices = (hold.slotPrices as unknown as { hour: number; price: number }[]) ?? [];
  const sortedSlots = [...slotPrices].sort((a, b) => a.hour - b.hour);
  const slotStartHour = sortedSlots.length > 0 ? sortedSlots[0].hour : undefined;
  const slotEndHour = sortedSlots.length > 0 ? sortedSlots[sortedSlots.length - 1].hour + 1 : undefined;
  const bookingDateStr = hold.date.toISOString().split("T")[0];

  // Parse recurring params
  const recurringEnabled = params.recurring === "1";
  const recurringMode = (params.mode as "weekly" | "daily") || "weekly";
  const recurringWeeksCount = params.weeksCount ? parseInt(params.weeksCount) : undefined;
  const recurringDaysCount = params.daysCount ? parseInt(params.daysCount) : undefined;
  const recurringDayOfWeek = params.dayOfWeek !== undefined ? parseInt(params.dayOfWeek) : undefined;
  const recurringStartDate = params.startDate;
  const recurringStartHour = params.startHour !== undefined ? parseInt(params.startHour) : undefined;
  const recurringEndHour = params.endHour !== undefined ? parseInt(params.endHour) : undefined;
  const recurringCourtConfigId = params.courtConfigId;
  const recurringDiscountPercent = params.discountPercent ? parseInt(params.discountPercent) : 0;

  const recurringCount = recurringMode === "daily" ? recurringDaysCount : recurringWeeksCount;
  const recurringGrossTotal = recurringEnabled && recurringCount
    ? hold.totalAmount * recurringCount
    : hold.totalAmount;
  const recurringDiscountAmount = recurringEnabled && recurringDiscountPercent > 0
    ? Math.round(recurringGrossTotal * recurringDiscountPercent / 100)
    : 0;
  const recurringNetTotal = recurringGrossTotal - recurringDiscountAmount;

  const recurringUnitLabel = recurringMode === "daily" ? "day" : "week";
  const recurringUnitPluralLabel = recurringMode === "daily" ? "days" : "weeks";
  const recurringCountDisplay = recurringCount || 0;

  const [newUserDiscount, paymentConfig] = await Promise.all([
    getNewUserDiscount(session.user.id, hold.courtConfig.sport, hold.totalAmount).catch(() => null),
    getCheckoutPaymentConfig(),
  ]);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-white">Complete Payment</h1>

      {/* Booking Summary */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-white">Booking Summary</h2>
          <span className="rounded-full bg-yellow-500/10 border border-yellow-500/30 px-2 py-0.5 text-xs text-yellow-400">
            Reserved
          </span>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-400">Sport</span>
            <span className="text-white">{sportInfo.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Type</span>
            <span className="text-white">{customerFacingCourtLabel(hold.courtConfig.label, hold.wasBookedAsHalfCourt)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Date</span>
            <span className="text-white">
              {formatBookingDate(hold.date, {
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
              {formatHoursAsRanges(sortedSlots.map((s) => s.hour))}
            </span>
          </div>
          {recurringEnabled && recurringCount && (
            <div className="flex justify-between">
              <span className="text-zinc-400">Recurring</span>
              <span className={recurringMode === "daily" ? "text-blue-400" : "text-emerald-400"}>
                {recurringMode === "daily" ? "Every day" : "Every week"} {"\u00D7"} {recurringCountDisplay} {recurringCountDisplay === 1 ? recurringUnitLabel : recurringUnitPluralLabel}
              </span>
            </div>
          )}
        </div>

        <div className="border-t border-zinc-800 pt-3">
          {sortedSlots.length > 1 && sortedSlots.map((slot) => (
            <div key={slot.hour} className="flex justify-between text-sm">
              <span className="text-zinc-500">{formatHourRangeCompact(slot.hour)}</span>
              <span className="text-zinc-300">{formatPrice(slot.price)}</span>
            </div>
          ))}
          {recurringEnabled && recurringCount && recurringCount > 1 && (
            <>
              <div className="mt-2 flex justify-between border-t border-zinc-800 pt-2 text-sm">
                <span className="text-zinc-400">Per {recurringUnitLabel}</span>
                <span className="text-zinc-300">{formatPrice(hold.totalAmount)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">{"\u00D7"} {recurringCountDisplay} {recurringUnitPluralLabel}</span>
                <span className="text-zinc-300">{formatPrice(recurringGrossTotal)}</span>
              </div>
              {recurringDiscountPercent > 0 && (
                <div className="flex justify-between text-sm">
                  <span className={recurringMode === "daily" ? "text-blue-400" : "text-emerald-400"}>
                    Recurring discount ({recurringDiscountPercent}%)
                  </span>
                  <span className={recurringMode === "daily" ? "text-blue-400" : "text-emerald-400"}>
                    -{formatPrice(recurringDiscountAmount)}
                  </span>
                </div>
              )}
            </>
          )}
          <div className="mt-2 flex justify-between border-t border-zinc-800 pt-2">
            <span className="font-semibold text-white">Total</span>
            <span className="text-lg font-bold text-emerald-400">
              {formatPrice(recurringEnabled && recurringCount ? recurringNetTotal : hold.totalAmount)}
            </span>
          </div>
        </div>
      </div>

      {/* Payment */}
      <CheckoutClient
        holdId={hold.id}
        amount={recurringEnabled && recurringCount ? recurringNetTotal : hold.totalAmount}
        perSessionAmount={recurringEnabled && recurringCount ? hold.totalAmount : undefined}
        recurringDiscountPercent={recurringDiscountPercent || undefined}
        sport={hold.courtConfig.sport}
        expiresAt={hold.expiresAt.toISOString()}
        userName={session.user.name || ""}
        userEmail={session.user.email || ""}
        userPhone={(session.user as { phone?: string }).phone || ""}
        razorpayOfferId={undefined}
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
        recurringMode={recurringMode}
        recurringWeeksCount={recurringWeeksCount}
        recurringDaysCount={recurringDaysCount}
        recurringDayOfWeek={recurringDayOfWeek}
        recurringStartDate={recurringStartDate}
        recurringStartHour={recurringStartHour}
        recurringEndHour={recurringEndHour}
        recurringCourtConfigId={recurringCourtConfigId}
        gateway={paymentConfig.activeGateway}
        onlineEnabled={paymentConfig.onlineEnabled}
        upiQrEnabled={paymentConfig.upiQrEnabled}
        advanceEnabled={paymentConfig.advanceEnabled}
      />
    </div>
  );
}
