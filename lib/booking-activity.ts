import { db } from "./db";
import { notifyUser } from "./user-notifications";
import { formatSlotsAsRanges } from "./court-config";

/**
 * Booking-activity notifications — bell row + push, for everything that
 * happens to a booking after it is made.
 *
 * Until now the only thing a customer heard about was the confirmation.
 * Payment marked at the venue, a cancellation, a slot moved, thirty
 * minutes added — all of it happened silently, so the app told them less
 * than the venue's WhatsApp did.
 *
 * Every call is fire-and-forget (`void notifyBookingActivity(...)`): a
 * notification must never fail or slow the operation that caused it, and
 * notifyUser already swallows push failures. Guest bookings (no userId)
 * are skipped — there is no one to notify.
 */

export type BookingActivity =
  | "PAYMENT_RECEIVED"
  | "PAYMENT_UPDATED"
  | "CANCELLED"
  | "REFUNDED"
  | "SLOTS_CHANGED"
  | "EXTENDED"
  | "COMPLETED"
  | "MARKED_ABSENT";

function inr(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/**
 * Copy per event. Kept in one table rather than scattered across the
 * actions so the voice stays consistent and a wording change is one edit.
 * `when` is "Cricket · 12 Aug · 6–7pm" — the booking a customer with
 * several open bookings needs to be able to tell apart at a glance.
 */
function compose(
  activity: BookingActivity,
  when: string,
  extra: { amount?: number; reason?: string | null; note?: string | null },
): { title: string; body: string } {
  switch (activity) {
    case "PAYMENT_RECEIVED":
      return {
        title: "Payment received 💳",
        body: extra.amount
          ? `We've received ${inr(extra.amount)} for your booking — ${when}. Thank you!`
          : `Your payment for ${when} has been received. Thank you!`,
      };
    case "PAYMENT_UPDATED":
      return {
        title: "Payment updated",
        body: `The payment on your booking (${when}) was updated${
          extra.note ? ` — ${extra.note}` : ""
        }. Open the booking for the latest amount.`,
      };
    case "CANCELLED":
      return {
        title: "Booking cancelled",
        body: `Your booking for ${when} has been cancelled${
          extra.reason ? ` — ${extra.reason}` : ""
        }.`,
      };
    case "REFUNDED":
      return {
        title: "Refund processed 💰",
        body: extra.amount
          ? `${inr(extra.amount)} has been refunded for your booking — ${when}. It should reach your account in 5–7 working days.`
          : `A refund has been processed for your booking — ${when}.`,
      };
    case "SLOTS_CHANGED":
      // The most important one to get right: the customer may already be
      // planning around the old time, so lead with the NEW time.
      return {
        title: "Booking time changed ⏰",
        body: `Your booking has moved to ${when}. Please check the new time before you set off.`,
      };
    case "EXTENDED":
      return {
        title: "Booking extended",
        body: `Extra time has been added to your booking — it now runs ${when}.`,
      };
    case "COMPLETED":
      return {
        title: "Thanks for playing! 🏅",
        body: `Your session (${when}) is complete. Hope you had a great game — book again any time.`,
      };
    case "MARKED_ABSENT":
      return {
        title: "Marked as no-show",
        body: `Your booking for ${when} was marked as a no-show. If that's wrong, please get in touch with the venue.`,
      };
  }
}

export async function notifyBookingActivity(
  bookingId: string,
  activity: BookingActivity,
  extra: { amount?: number; reason?: string | null; note?: string | null } = {},
): Promise<void> {
  try {
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      include: {
        slots: { orderBy: { startHour: "asc" } },
        courtConfig: { select: { sport: true } },
      },
    });
    // No row, or a walk-in with no account — nobody to tell.
    if (!booking?.userId) return;

    const dateLabel = booking.date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      timeZone: "Asia/Kolkata",
    });
    const timeLabel =
      booking.slots.length > 0 ? formatSlotsAsRanges(booking.slots) : "";
    const sport = String(booking.courtConfig.sport);
    const sportTitle = sport.charAt(0) + sport.slice(1).toLowerCase();
    const when = [sportTitle, dateLabel, timeLabel].filter(Boolean).join(" · ");

    const { title, body } = compose(activity, when, extra);
    await notifyUser(booking.userId, {
      type: `BOOKING_${activity}`,
      title,
      body,
      link: `/account?tab=bookings`,
      // Push as well as the row — the whole point is that the customer
      // finds out without opening the app.
    });
  } catch (err) {
    // Never let a notification take down the operation that triggered it.
    console.error(`[booking-activity] ${activity} notify failed:`, err);
  }
}
