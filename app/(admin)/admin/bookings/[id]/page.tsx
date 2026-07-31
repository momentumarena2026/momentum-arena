import { db } from "@/lib/db";
import { passBandsCoverHours, getPassOfferForHold } from "@/lib/passes";
import { notFound } from "next/navigation";
import { SPORT_INFO, SIZE_INFO, formatSlotsAsRanges } from "@/lib/court-config";
import { formatPrice, formatBookingDate } from "@/lib/pricing";
import Link from "next/link";
import { ArrowLeft, Calendar, Clock, User, Receipt, MapPin, Repeat, Banknote, CheckCircle2 } from "lucide-react";
import { MarkCollectedButton } from "./mark-collected-button";
import { EditSplitButton } from "./edit-split-button";
import { AdminBookingActions } from "./admin-actions";
import { EquipmentEditor } from "./equipment-editor";
import { ExtendBookingControls } from "./extend-buttons";
import { BookingEditHistory } from "@/components/admin/booking-edit-history";
import {
  getBookingEquipmentSnapshot,
  listEquipmentForAdmin,
} from "@/actions/admin-equipment-rental";
import { suggestExtendPrice } from "@/actions/admin-booking";

export default async function AdminBookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const booking = await db.booking.findUnique({
    where: { id },
    include: {
      user: true,
      courtConfig: true,
      slots: { orderBy: { startHour: "asc" } },
      payment: true,
      editHistory: { orderBy: { createdAt: "desc" } },
      recurringBooking: {
        include: {
          bookings: {
            orderBy: { date: "asc" },
            select: { id: true, date: true, status: true, totalAmount: true },
          },
        },
      },
    },
  });

  if (!booking) notFound();

  // Discount surfaces from two systems:
  //   1. Legacy DiscountCode (Booking.discountCodeId + Booking.discountAmount)
  //   2. Unified Coupon (CouponUsage with matching bookingId)
  // The legacy path updates booking.totalAmount in-place; the coupon path
  // records discount only on CouponUsage. Read both and prefer the populated one.
  const [legacyDiscountCode, couponUsage] = await Promise.all([
    booking.discountCodeId
      ? db.discountCode.findUnique({
          where: { id: booking.discountCodeId },
          select: { code: true },
        })
      : Promise.resolve(null),
    db.couponUsage.findFirst({
      where: { bookingId: booking.id },
      select: { discountAmount: true, coupon: { select: { code: true } } },
    }),
  ]);
  const discountCodeLabel =
    legacyDiscountCode?.code ?? couponUsage?.coupon.code ?? null;
  const discountAmountShown =
    booking.discountAmount > 0
      ? booking.discountAmount
      : couponUsage?.discountAmount ?? 0;

  // Fetch all active court configs across sports so the edit-booking
  // modal can also handle "oops, I logged this as cricket but it's
  // football" fixes. The modal groups the dropdown by sport; the
  // underlying `adminEditBookingFull` action already re-validates
  // availability, blocks, and re-prices slots against the new config.
  const courtConfigs = await db.courtConfig.findMany({
    where: { isActive: true },
    select: { id: true, label: true, size: true, position: true, sport: true },
    orderBy: [{ sport: "asc" }, { position: "asc" }],
  });

  // Equipment editor needs (a) the current rentals + recomputed totals
  // and (b) the catalog of items the admin may add. Fetch both in
  // parallel; the catalog stays empty for sport/category combos with
  // nothing rentable, in which case the editor renders a "no items
  // available" hint.
  const [
    equipmentSnapshot,
    equipmentCatalog,
    suggestedBeforePrice,
    suggestedAfterPrice,
    passRedemptionRow,
  ] = await Promise.all([
    getBookingEquipmentSnapshot(booking.id),
    listEquipmentForAdmin(booking.id),
    // Pre-computed defaults for the +30 min extend dialog so the
    // admin sees a sensible pre-filled price without an extra
    // roundtrip when they click the button. Half the adjacent slot's
    // hourly rate for hourly bookings; the same rate for bowling's
    // already-30-min slots.
    suggestExtendPrice(booking.id, "before"),
    suggestExtendPrice(booking.id, "after"),
    // Pass redemption backing this booking (if any) — carries the value
    // attribution (worth at the pass's effective rate) and the list-price
    // amount the pass settled (drives owed-at-venue math).
    db.passRedemption.findMany({
      where: { bookingId: booking.id, restoredAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        minutes: true,
        value: true,
        coveredAmount: true,
        userPassId: true,
        userPass: { select: { name: true } },
      },
    }),
  ]);
  // Live redemptions only (restored rows settle nothing). A booking may
  // draw on several passes — one row each; the FIRST keeps the legacy
  // single-pass call sites working (extend pinning etc.).
  const passRedemptions = passRedemptionRow;
  const passRedemption = passRedemptions[0] ?? null;
  const passCoveredTotal = passRedemptions.reduce(
    (sum, r) => sum + r.coveredAmount,
    0,
  );
  const passValueTotal = passRedemptions.reduce((sum, r) => sum + r.value, 0);
  void passValueTotal;

  // "Move to pass payment" option for the Edit Payment modal: offered
  // when the booking is money-paid (no live redemption, not PASS) but
  // the customer's passes could cover its slots. Same multi-pass
  // engine as checkout, computed on the booking's own slot rows.
  const passConvertOption =
    passRedemptions.length === 0 &&
    booking.userId &&
    booking.payment &&
    booking.payment.method !== "PASS" &&
    booking.status !== "CANCELLED"
      ? await getPassOfferForHold({
          userId: booking.userId,
          courtConfigId: booking.courtConfigId,
          date: booking.date,
          hours: booking.slots.map((sl) => sl.startHour),
          startMinutes: booking.slots.map((sl) => sl.startMinute),
          totalAmount: booking.slots.reduce((sum, sl) => sum + sl.price, 0),
          slotPrices: booking.slots.map((sl) => ({
            hour: sl.startHour,
            minute: sl.startMinute,
            price: sl.price,
          })),
          equipmentTotalAmount: booking.equipmentTotalAmount ?? 0,
          courtConfig: {
            slotDurationMinutes: booking.slots.some(
              (sl) => sl.durationMinutes === 30,
            )
              ? 30
              : 60,
          },
        })
          .then((offer) =>
            offer
              ? {
                  fullCoverage: offer.fullCoverage,
                  remainderAmount: offer.remainderAmount,
                  passes: offer.passes.map((sh) => ({
                    passName: sh.passName,
                    coveredMinutes: sh.coveredMinutes,
                  })),
                }
              : null,
          )
          .catch(() => null)
      : null;

  // Eligible pass for a pass-paid extension — same rules as customer
  // redemption (this customer, this court, ACTIVE, ≥30 min), with
  // validity judged against the BOOKING's play date: the pass must have
  // started by then and not expire before it.
  // Court-GROUP matching (both cricket half-courts etc.), not strict
  // config equality — a pass stored on LEFT must cover a RIGHT booking,
  // same as checkout redemption.
  const groupSiblingIds = await (async () => {
    const bc = booking.courtConfig;
    const siblings = await db.courtConfig.findMany({
      where: { sport: bc.sport, size: bc.size, category: bc.category },
      select: { id: true },
    });
    return siblings.map((s) => s.id);
  })();
  // A live redemption pins the pass: extends must debit the SAME pass
  // the booking already redeems (extendBookingByThirtyMin rejects any
  // other), so offer the attached pass if it's still usable — and only
  // fall back to the best-eligible pass when nothing is attached. This
  // never silently switches the customer to a different pass.
  const extendCandidates = booking.userId
    ? await db.userPass.findMany({
        where: passRedemption
          ? {
              id: passRedemption.userPassId,
              courtConfigId: { in: groupSiblingIds },
              status: "ACTIVE",
              remainingMinutes: { gte: 30 },
              startsAt: { lte: booking.date },
              expiresAt: { gt: booking.date },
            }
          : {
              // Owner or shared member — same eligibility as checkout.
              OR: [
                { userId: booking.userId },
                { members: { some: { userId: booking.userId } } },
              ],
              courtConfigId: { in: groupSiblingIds },
              status: "ACTIVE",
              remainingMinutes: { gte: 30 },
              startsAt: { lte: booking.date },
              expiresAt: { gt: booking.date },
            },
        orderBy: { expiresAt: "asc" },
        select: { id: true, name: true, remainingMinutes: true, bands: true },
      })
    : [];
  // Only OFFER a pass whose price bands can cover time on this booking
  // — the server enforces bands on save, so an unfiltered offer meant
  // admins were shown "cover with pass" and then rejected.
  let extendPass: {
    id: string;
    name: string;
    remainingMinutes: number;
  } | null = null;
  // Which hours might this pass be asked to pay for? The booking's own
  // hours (an edit adding time beside them) and the two an extend would
  // reach. Requiring ALL of them would hide the option whenever a
  // booking sits on a band edge; requiring at least one keeps it
  // offered, and the server band-checks the exact hour on save.
  const bookedHours = booking.slots.map((s) => s.startHour);
  const candidateHours = [
    ...new Set([
      ...bookedHours,
      Math.max(0, Math.min(...bookedHours) - 1),
      (Math.max(...bookedHours) + 1) % 24,
    ]),
  ];
  for (const candidate of extendCandidates) {
    const covers = (
      await Promise.all(
        candidateHours.map((h) =>
          passBandsCoverHours(candidate, booking.courtConfigId, booking.date, [h]),
        ),
      )
    ).some(Boolean);
    if (covers) {
      extendPass = {
        id: candidate.id,
        name: candidate.name,
        remainingMinutes: candidate.remainingMinutes,
      };
      break;
    }
  }

  const sportInfo = SPORT_INFO[booking.courtConfig.sport];
  const sizeInfo = SIZE_INFO[booking.courtConfig.size];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/admin/bookings"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Bookings
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Booking Detail</h1>
        <div className="flex items-center gap-2">
          {booking.createdByAdminId && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400">
              Created by Admin
            </span>
          )}
          <span
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              booking.status === "CONFIRMED"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : booking.status === "PENDING"
                ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
                : "border-red-500/30 bg-red-500/10 text-red-400"
            }`}
          >
            {booking.status}
          </span>
        </div>
      </div>

      {/* User Info */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-500">
          <User className="h-4 w-4" />
          Customer
        </h2>
        <div className="space-y-1">
          <p className="font-medium text-white">
            {booking.user.name || "—"}
          </p>
          {booking.user.email && (
            <p className="text-sm text-zinc-400">{booking.user.email}</p>
          )}
          {booking.user.phone && (
            <p className="text-sm text-zinc-400">{booking.user.phone}</p>
          )}
        </div>
      </div>

      {/* Booking Info */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
        <h2 className="text-sm font-medium text-zinc-500">Booking Details</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-400 flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> Sport
            </span>
            <span className="text-white">{sportInfo.name} — {sizeInfo.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Court</span>
            <span className="text-white">{booking.courtConfig.label}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> Date
            </span>
            <span className="text-white">
              {formatBookingDate(booking.date, {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Slots
            </span>
            <span className="text-white">
              {formatSlotsAsRanges(booking.slots)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Booking ID</span>
            <span className="font-mono text-xs text-zinc-500">{booking.id}</span>
          </div>
          {discountCodeLabel && discountAmountShown > 0 && (
            <>
              <div className="flex justify-between">
                <span className="text-zinc-400">Discount Code</span>
                <span className="font-mono text-emerald-400">{discountCodeLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Discount</span>
                <span className="text-emerald-400">−{formatPrice(discountAmountShown)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Recurring Series Info */}
      {booking.recurringBooking && (
        <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-5 space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-medium text-purple-400">
            <Repeat className="h-4 w-4" />
            Recurring Series
            <span className="rounded border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-semibold">
              {booking.recurringBooking.mode === "daily" ? "Daily" : "Weekly"}
            </span>
          </h2>
          <div className="flex flex-wrap gap-2">
            {booking.recurringBooking.bookings.map((sb) => {
              const isCurrentBooking = sb.id === booking.id;
              return (
                <Link
                  key={sb.id}
                  href={`/admin/bookings/${sb.id}`}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                    isCurrentBooking
                      ? "border-purple-400 bg-purple-500/20 text-purple-300 ring-1 ring-purple-400/50"
                      : sb.status === "CONFIRMED"
                      ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400 hover:bg-emerald-500/10"
                      : sb.status === "CANCELLED"
                      ? "border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10"
                      : "border-yellow-500/20 bg-yellow-500/5 text-yellow-400 hover:bg-yellow-500/10"
                  }`}
                >
                  {formatBookingDate(sb.date, { day: "numeric", month: "short" })}
                  {isCurrentBooking && " ← current"}
                </Link>
              );
            })}
          </div>
          <p className="text-xs text-zinc-500">
            {booking.recurringBooking.bookings.length} bookings · Total:{" "}
            {formatPrice(booking.recurringBooking.bookings.reduce((sum, b) => sum + b.totalAmount, 0))}
          </p>
        </div>
      )}

      {/* Payment Info */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-500">
          <Receipt className="h-4 w-4" />
          Payment
        </h2>
        {booking.payment ? (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-400">Method</span>
              <span className="text-white">{booking.payment.method.replace("_", " ")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Status</span>
              <span
                className={`font-medium ${
                  booking.payment.status === "COMPLETED"
                    ? "text-emerald-400"
                    : booking.payment.status === "PARTIAL"
                    ? "text-amber-300"
                    : booking.payment.status === "PENDING"
                    ? "text-yellow-400"
                    : booking.payment.status === "REFUNDED"
                    ? "text-blue-400"
                    : "text-red-400"
                }`}
              >
                {booking.payment.status}
              </span>
            </div>
            {booking.status === "ABSENT" ? (
              // Absent bookings: the venue keeps whatever the customer
              // already paid (the advance, or the full amount for
              // fully-paid bookings). Anything still owed is forfeit
              // — not chased, not refunded. Show the retained earning
              // as the primary figure and the original booking total
              // as struck-through context so admins reading the page
              // see at a glance what actually closed.
              (() => {
                const retained = booking.payment.amount;
                const forfeit = Math.max(
                  booking.totalAmount - retained,
                  0,
                );
                return (
                  <>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">
                        Advance retained
                      </span>
                      <span className="text-lg font-bold text-amber-300">
                        {formatPrice(retained)}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-500">Booking total</span>
                      <span className="text-zinc-500 line-through">
                        {formatPrice(booking.totalAmount)}
                      </span>
                    </div>
                    {forfeit > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-zinc-500">
                          Remainder forfeit (no-show)
                        </span>
                        <span className="text-zinc-500">
                          {formatPrice(forfeit)}
                        </span>
                      </div>
                    )}
                    <div className="mt-1 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200">
                      Customer no-show. Only the advance is counted as
                      earnings — the remainder is forfeit and not
                      refunded.
                    </div>
                  </>
                );
              })()
            ) : passRedemption ? (
              <>
                {/* Pass-paid booking: money and pass value are separate
                    figures. Revenue was recognised when the pass was
                    bought — the "worth" line is attribution, not a second
                    collection. The slot list price stays for context. */}
                <div className="flex justify-between">
                  <span className="text-zinc-400">Collected (money)</span>
                  <span className="text-lg font-bold text-white">
                    {formatPrice(booking.payment.amount)}
                  </span>
                </div>
                {passRedemptions.map((red) => (
                  <div
                    key={red.userPassId}
                    className="flex justify-between text-xs"
                  >
                    <span className="text-emerald-400">
                      Paid with pass — {red.userPass.name} (
                      {(red.minutes / 60).toFixed(1).replace(/\.0$/, "")}
                      h)
                    </span>
                    <span className="font-semibold text-emerald-400">
                      worth {formatPrice(red.value)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">Slot list price</span>
                  <span className="text-zinc-500 line-through">
                    {formatPrice(booking.totalAmount)}
                  </span>
                </div>
                <div className="mt-1 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-200/90">
                  Nothing to collect for the covered hours — their revenue
                  was recognised when the pass was purchased.
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Amount</span>
                  <span className="text-lg font-bold text-white">
                    {/* Show Booking.totalAmount (authoritative post-discount) rather
                        than Payment.amount. Payment.amount can legitimately drift
                        from the final owed figure — e.g. partial-payment bookings
                        where markRemainderCollected adds `remaining` onto the
                        pre-discount gateway charge, leaving Payment.amount at the
                        pre-coupon total while Booking.totalAmount correctly shows
                        the post-coupon total the customer actually owes / paid. */}
                    {formatPrice(booking.totalAmount)}
                  </span>
                </div>
                {booking.originalAmount !== null &&
                  booking.originalAmount > booking.totalAmount && (
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-500">Original</span>
                      <span className="text-zinc-500 line-through">
                        {formatPrice(booking.originalAmount)}
                      </span>
                    </div>
                  )}
              </>
            )}
            {booking.payment.isPartialPayment && (() => {
              const advance =
                booking.payment.advanceAmount ?? 0;
              const total = booking.totalAmount;
              // Derive the owed-at-venue figure from totalAmount - advance
              // (post-discount) rather than trusting Payment.remainingAmount,
              // which historically stored `hold.totalAmount - advance`
              // (pre-discount) and ended up ₹100 high on every coupon-applied
              // booking. Payment.remainingAmount is still authoritative for
              // the "collected?" flag (it flips to 0 when markRemainderCollected
              // runs), but the amount shown and charged to the customer is
              // derived so the UI stays correct regardless of stored drift.
              const storedRemaining = booking.payment.remainingAmount ?? 0;
              const collected = storedRemaining <= 0;
              const remaining = collected ? 0 : Math.max(total - advance, 0);
              const percentPaid =
                total > 0 ? Math.round((advance / total) * 100) : 0;
              const borderClass = collected
                ? "border-emerald-500/30 bg-emerald-500/10"
                : "border-amber-500/30 bg-amber-500/10";
              const headerColor = collected ? "text-emerald-400" : "text-amber-400";
              const HeaderIcon = collected ? CheckCircle2 : Banknote;
              const methodLabel = (m: string) =>
                m === "UPI_QR" ? "UPI QR" : m.charAt(0) + m.slice(1).toLowerCase();
              const advanceMethodLabel = methodLabel(booking.payment.method);
              // Resolve how the remainder was collected. Prefer the
              // explicit split columns; fall back to the legacy single
              // `remainderMethod` enum for rows that predate split
              // collection.
              const venueTotal = total - advance;
              const hasSplitFields =
                booking.payment.remainderCashAmount !== null ||
                booking.payment.remainderUpiAmount !== null;
              const remainderCash = hasSplitFields
                ? booking.payment.remainderCashAmount ?? 0
                : booking.payment.remainderMethod === "CASH"
                ? venueTotal
                : 0;
              const remainderUpi = hasSplitFields
                ? booking.payment.remainderUpiAmount ?? 0
                : booking.payment.remainderMethod === "UPI_QR"
                ? venueTotal
                : 0;
              const remainderDiscount =
                booking.payment.remainderDiscountAmount ?? 0;
              const isSplit =
                [remainderCash, remainderUpi, remainderDiscount].filter(
                  (n) => n > 0,
                ).length > 1;
              const remainderLabel = collected
                ? isSplit
                  ? [
                      remainderCash > 0
                        ? `${formatPrice(remainderCash)} Cash`
                        : null,
                      remainderUpi > 0
                        ? `${formatPrice(remainderUpi)} UPI QR`
                        : null,
                      remainderDiscount > 0
                        ? `${formatPrice(remainderDiscount)} Discount`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" + ")
                  : remainderCash > 0
                  ? "Cash"
                  : remainderUpi > 0
                  ? "UPI QR"
                  : remainderDiscount > 0
                  ? "Discount"
                  : booking.payment.remainderMethod
                  ? methodLabel(booking.payment.remainderMethod)
                  : null
                : null;
              return (
              <div className={`mt-2 rounded-lg border p-3 space-y-1.5 ${borderClass}`}>
                <p className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${headerColor}`}>
                  <HeaderIcon className="h-3.5 w-3.5" />
                  {collected
                    ? `Paid in Full \u00B7 ${percentPaid}% Was Advance`
                    : `${percentPaid}% Advance Booking`}
                </p>
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-400">
                    Advance paid <span className="text-zinc-500">· {advanceMethodLabel}</span>
                  </span>
                  <span className="font-semibold text-emerald-400">
                    {formatPrice(advance)}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className={collected ? "text-emerald-200" : "text-amber-200"}>
                    {collected
                      ? `Collected at venue${remainderLabel ? ` · ${remainderLabel}` : ""}`
                      : "Collect at venue"}
                  </span>
                  <span className={`font-bold ${collected ? "text-emerald-300" : "text-amber-300"}`}>
                    {formatPrice(collected ? venueTotal : remaining)}
                  </span>
                </div>
                {!collected && (
                  <MarkCollectedButton
                    bookingId={booking.id}
                    remainingAmount={remaining}
                    formattedRemaining={formatPrice(remaining)}
                  />
                )}
                {collected && venueTotal > 0 && (
                  <EditSplitButton
                    bookingId={booking.id}
                    venueTotal={venueTotal}
                    initialCash={remainderCash}
                    initialUpi={remainderUpi}
                    initialDiscount={remainderDiscount}
                  />
                )}
              </div>
              );
            })()}

            {/* Refund-due pill: surfaces when the booking was edited
                after a full payment and the new total is below what
                was actually captured (e.g. customer asked to switch
                full court → half court). The captured amount on
                Payment.amount stays intact (audit trail of what
                Razorpay/PhonePe charged); the difference is what the
                admin needs to refund out-of-band via the gateway
                dashboard. The complementary "collect ₹X extra at
                venue" case is handled automatically by the
                partial-payment block above — adminEditBookingFull
                flips the payment to PARTIAL when newTotal > captured. */}
            {!booking.payment.isPartialPayment &&
              booking.payment.status === "COMPLETED" &&
              booking.payment.amount > booking.totalAmount && (
                <div className="mt-2 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 space-y-1.5">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-blue-400">
                    <Receipt className="h-3.5 w-3.5" />
                    Booking modified · Refund due
                  </p>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Captured</span>
                    <span className="text-zinc-200">
                      {formatPrice(booking.payment.amount)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">New total</span>
                    <span className="text-zinc-200">
                      {formatPrice(booking.totalAmount)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-blue-200">Refund to customer</span>
                    <span className="font-bold text-blue-300">
                      {formatPrice(booking.payment.amount - booking.totalAmount)}
                    </span>
                  </div>
                  <p className="pt-1 text-[10px] text-zinc-500">
                    Process the refund via the{" "}
                    {booking.payment.method === "RAZORPAY"
                      ? "Razorpay"
                      : booking.payment.method === "PHONEPE"
                      ? "PhonePe"
                      : "payment gateway"}{" "}
                    dashboard, then mark Payment refunded above if it should
                    no longer count toward revenue.
                  </p>
                </div>
              )}
            {booking.payment.razorpayPaymentId && (
              <div className="flex justify-between">
                <span className="text-zinc-400">Razorpay ID</span>
                <span className="font-mono text-xs text-zinc-500">
                  {booking.payment.razorpayPaymentId}
                </span>
              </div>
            )}
            {booking.payment.confirmedAt && (
              <div className="flex justify-between">
                <span className="text-zinc-400">Confirmed</span>
                <span className="text-zinc-300">
                  {booking.payment.confirmedAt.toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  })}
                </span>
              </div>
            )}
            {booking.payment.refundReason && (
              <div className="mt-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                <p className="text-xs text-blue-400">Refund Reason</p>
                <p className="text-sm text-zinc-300">{booking.payment.refundReason}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No payment recorded</p>
        )}
      </div>

      {/* Equipment editor — admins can add/remove rentals after the
          booking was created. Always rendered: even when the catalog
          is empty the editor surfaces existing rentals or an empty-
          state message, which is cleaner than hiding the section. */}
      <EquipmentEditor
        bookingId={booking.id}
        initialRentals={equipmentSnapshot.rentals}
        catalog={equipmentCatalog.map((c) => ({
          id: c.id,
          name: c.name,
          pricePerUnitPaise: c.pricePerUnitPaise,
          category: c.category,
        }))}
        initialEquipmentTotalRupees={equipmentSnapshot.equipmentTotalRupees}
        initialBookingTotalRupees={equipmentSnapshot.bookingTotalRupees}
        // Owed-at-venue = total − money paid − what the pass settled at
        // list price. Without the pass term, a fully pass-paid booking
        // (money = ₹0) showed its whole slot total as "Collect at venue".
        paymentAmountRupees={
          booking.payment
            ? booking.payment.amount + passCoveredTotal
            : null
        }
      />

      {/* Quick +30 min extension controls. Lives just above the
          full Manage-this-booking section so admins can extend a
          live booking in one tap (the common "stayed late" /
          "started early" case) without going through the full
          slot-edit modal. Hidden for non-live statuses by the
          component itself. */}
      <ExtendBookingControls
        bookingId={booking.id}
        bookingStatus={booking.status}
        suggestedBeforePrice={suggestedBeforePrice}
        suggestedAfterPrice={suggestedAfterPrice}
        pass={
          extendPass
            ? {
                id: extendPass.id,
                name: extendPass.name,
                remainingMinutes: extendPass.remainingMinutes,
              }
            : null
        }
      />

      {/* Admin Actions — hosts the Edit / Cancel / status-change
          controls. Tagged with #admin-actions so external "Edit"
          affordances (e.g. the booking-calendar tile's Edit CTA)
          can deep-link straight here instead of falling through to a
          non-existent /edit route. Wrapped in a labelled <section>
          so a deep-link from the calendar lands on the visible
          "Manage this booking" heading, giving the staffer immediate
          confirmation they're in the right place. */}
      <section id="admin-actions" className="scroll-mt-20">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Manage this booking
        </h2>
        <AdminBookingActions
        deltaPass={
          extendPass
            ? {
                name: extendPass.name,
                remainingMinutes: extendPass.remainingMinutes,
              }
            : null
        }
          bookingId={booking.id}
          bookingStatus={booking.status}
          totalAmount={booking.totalAmount}
          paymentMethod={booking.payment?.method || null}
          paymentStatus={booking.payment?.status || null}
          paymentAmount={booking.payment?.amount || null}
          isPartialPayment={booking.payment?.isPartialPayment ?? false}
          currentAdvanceAmount={booking.payment?.advanceAmount ?? null}
          razorpayPaymentId={booking.payment?.razorpayPaymentId ?? null}
          utrNumber={booking.payment?.utrNumber ?? null}
          passConvertOption={passConvertOption}
          isPassPaid={passRedemptions.length > 0 || booking.payment?.method === "PASS"}
          isAdminCreated={!!booking.createdByAdminId}
          courtConfigId={booking.courtConfigId}
          date={booking.date.toISOString().split("T")[0]}
          currentSlots={booking.slots.map((s) => s.startHour)}
          currentSlotMinutes={booking.slots.reduce<Record<number, number>>(
            (acc, s) => {
              acc[s.startHour] = (acc[s.startHour] ?? 0) + s.durationMinutes;
              return acc;
            },
            {},
          )}
          // Treat the court as 30-min bowling whenever EITHER the
          // explicit slotDurationMinutes is 30 OR the category is
          // BOWLING_MACHINE. The two signals can drift apart in seed
          // data — the slotDurationMinutes column was added later so
          // older bowling rows still carry the default 60. Reading
          // the category as a fallback keeps the edit modal honest
          // for bookings whose court hasn't been re-seeded.
          slotDurationMinutes={
            (booking.courtConfig.slotDurationMinutes ?? 60) === 30 ||
            booking.courtConfig.category === "BOWLING_MACHINE"
              ? 30
              : (booking.courtConfig.slotDurationMinutes ?? 60)
          }
          currentBowlingSlots={
            (booking.courtConfig.slotDurationMinutes ?? 60) === 30 ||
            booking.courtConfig.category === "BOWLING_MACHINE"
              ? booking.slots.map((s) => ({
                  hour: s.startHour,
                  minute: (s.startMinute === 30 ? 30 : 0) as 0 | 30,
                }))
              : undefined
          }
          sport={booking.courtConfig.sport}
          courtConfigs={courtConfigs}
        />
      </section>

      {/* Edit History */}
      {booking.editHistory.length > 0 && (
        <BookingEditHistory
          history={booking.editHistory.map((h) => ({
            ...h,
            previousDate: h.previousDate?.toISOString() ?? null,
            newDate: h.newDate?.toISOString() ?? null,
            createdAt: h.createdAt.toISOString(),
          }))}
        />
      )}
    </div>
  );
}
