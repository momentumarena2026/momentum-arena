import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { EquipmentSnapshotItem } from "@/lib/equipment";
import { redirect, notFound } from "next/navigation";
import { SPORT_INFO, SIZE_INFO, formatHourRangeCompact, formatHoursAsRanges, customerFacingCourtLabel } from "@/lib/court-config";
import { formatPrice, formatBookingDate } from "@/lib/pricing";
import { getNewUserDiscount } from "@/lib/new-user-discount";
import { getCheckoutPaymentConfig } from "@/actions/admin-payment-settings";
import { getActiveSportPromo } from "@/actions/sport-promo";
import { computeAutoApplyDiscount } from "@/lib/auto-apply-promo";
import { getRewardConfig } from "@/lib/rewards/config";
import { CheckoutClient } from "./checkout-client";
import { SummaryFooter } from "./summary-footer";

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

  const [newUserDiscount, paymentConfig, sportPromo, rewardConfig] =
    await Promise.all([
      getNewUserDiscount(
        session.user.id,
        hold.courtConfig.sport,
        hold.totalAmount,
        hold.courtConfig.category,
      ).catch(() => null),
      getCheckoutPaymentConfig(),
      getActiveSportPromo(hold.courtConfig.sport, hold.courtConfig.category).catch(
        () => null,
      ),
      // Reward engine config — drives the "you'll earn X Points"
      // line in the Booking Summary footer. SSR'd once + handed to
      // SummaryFooter; the actual earn projection is recomputed on
      // the client whenever Total changes (coupon/redeem/advance
      // toggles).
      getRewardConfig(),
    ]);

  // Earn-rate that will actually fire when the booking is committed.
  // Mirror of `awardBookingPoints` gating in lib/rewards/earn.ts:
  // engine on, rate > 0, and (if enabledSports is non-empty) the
  // sport is included. Customer-originated only — there's no
  // createdByAdminId on the hold, but if the customer is on this
  // page they're checking out themselves, so admin-created doesn't
  // apply here. Returns 0 → SummaryFooter hides the line.
  const earnRateBookingBps =
    rewardConfig.enabled &&
    rewardConfig.earnRateBookingBps > 0 &&
    (rewardConfig.enabledSports.length === 0 ||
      rewardConfig.enabledSports.includes(hold.courtConfig.sport))
      ? rewardConfig.earnRateBookingBps
      : 0;

  // Rental gear selected on the slot-selection page and snapshotted
  // onto the hold at lock time (see /api/booking/lock). Read-only here
  // — checkout displays it in the Booking Summary alongside the slot
  // total, but the customer can't toggle items on this screen any
  // more. If they need to change their picks, the back button on
  // the checkout page sends them back to the slot picker.
  const equipmentSnapshot =
    (hold.equipmentSelection as unknown as EquipmentSnapshotItem[] | null) ?? [];
  const equipmentTotalRupees = hold.equipmentTotalAmount ?? 0;

  // Predict which auto-applied discount will actually fire so the
  // Booking Summary's Total reflects what the user pays — was showing
  // the pre-discount hold.totalAmount even though the launch promo
  // applied client-side and the "Pay" button below already used the
  // discounted amount. Mirrors checkout-client.tsx's priority:
  // new-user beats sport promo. Only shown for non-recurring +
  // uncapped PERCENTAGE promos (recurring has its own dedicated
  // discount math; flat promos don't slice cleanly here).
  const showSportPromo =
    !recurringEnabled && !newUserDiscount && sportPromo?.percentOff != null;
  const sportPromoDiscount = showSportPromo && sportPromo
    ? computeAutoApplyDiscount(hold.totalAmount, sportPromo)
    : 0;

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
          {/* Auto-applied launch-promo line item — only when sport
              promo will fire (no recurring, no new-user discount, and
              the coupon is an uncapped PERCENTAGE). Keeps the
              displayed Total in sync with the "Pay" button below,
              which already used the discounted amount. */}
          {showSportPromo && sportPromo && sportPromoDiscount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-yellow-300">
                Launch offer ({sportPromo.percentOff}% off)
              </span>
              <span className="text-yellow-300">
                -{formatPrice(sportPromoDiscount)}
              </span>
            </div>
          )}
          {/* Rental gear — read-only summary of what was picked on
              the slot-selection page. The old interactive "Rent gear"
              card has moved upstream so this row simply restates the
              snapshot. Hidden when nothing was rented. */}
          {equipmentSnapshot.length > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">
                Gear ({equipmentSnapshot.length} item
                {equipmentSnapshot.length === 1 ? "" : "s"})
                <span className="ml-1 text-zinc-600">
                  · {equipmentSnapshot.map((e) => e.name).join(", ")}
                </span>
              </span>
              <span className="text-zinc-300">
                +{formatPrice(equipmentTotalRupees)}
              </span>
            </div>
          )}
          {/* Redeem checkbox row + reactive Total — lives inside
              this summary tile per the customer's request. The
              row only renders when the customer has redeemable
              points (RedeemSlider returns null otherwise) so a
              user with zero points sees just the Total. */}
          <SummaryFooter
            holdId={hold.id}
            preDiscountTotal={
              (recurringEnabled && recurringCount
                ? recurringNetTotal
                : hold.totalAmount) - sportPromoDiscount
            }
            equipmentTotalRupees={equipmentTotalRupees}
            earnRateBookingBps={earnRateBookingBps}
          />
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
        dqrEnabled={paymentConfig.dqrEnabled}
        // Rental selection is locked from the slot-selection page;
        // checkout only needs the rupees total to add into the payable.
        // The Booking Summary tile renders the per-item line server-
        // side from hold.equipmentSelection.
        lockedEquipmentTotalRupees={equipmentTotalRupees}
        // Slot count = number of BookingSlot rows on the hold. The
        // checkout client multiplies the rental rate by this so a
        // 3-slot booking shows ₹300 for a ₹100/slot rental. Server
        // applies the same multiplier on commit.
        slotCount={Math.max(1, hold.hours.length)}
      />
    </div>
  );
}
