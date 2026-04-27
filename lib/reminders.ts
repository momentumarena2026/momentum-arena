import { db } from "@/lib/db";
import { formatHourRangeCompact, SPORT_INFO } from "@/lib/court-config";
import { normalizeIndianPhone } from "@/lib/phone";
import { sendToUser } from "@/lib/push";
import type { PushKind } from "@/lib/push";

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;

async function sendSmsReminder(
  phone: string,
  message: string
): Promise<boolean> {
  if (!MSG91_AUTH_KEY) {
    console.log(`[DEV] SMS Reminder to ${phone}: ${message}`);
    return true;
  }

  try {
    const response = await fetch(
      "https://control.msg91.com/api/v5/flow/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authkey: MSG91_AUTH_KEY,
        },
        body: JSON.stringify({
          template_id:
            process.env.MSG91_REMINDER_TEMPLATE_ID || "",
          recipients: [
            {
              mobiles: normalizeIndianPhone(phone),
              message,
            },
          ],
        }),
      }
    );

    const data = await response.json();
    return data.type === "success";
  } catch (error) {
    console.error("SMS reminder send error:", error);
    return false;
  }
}

// Fire-and-forget push reminder. Mirrors the SMS but lands silently on
// the lock screen for users who installed the mobile app — avoids the
// SMS delay (and DLT cost) for the common case. SMS still goes out so
// users without the app aren't left without a reminder.
async function sendPushReminder(
  userId: string,
  bookingId: string,
  kind: Extract<PushKind, "booking_reminder_24h" | "booking_reminder_2h">,
  title: string,
  body: string,
): Promise<void> {
  try {
    await sendToUser(userId, {
      title,
      body,
      data: { kind, bookingId },
    });
  } catch (error) {
    console.error(`Push reminder ${kind} failed for booking ${bookingId}:`, error);
  }
}

export async function sendBookingReminders(): Promise<{
  sent24h: number;
  sent2h: number;
  errors: number;
}> {
  const now = new Date();
  const results = { sent24h: 0, sent2h: 0, errors: 0 };

  // -- 24-hour reminders --
  // Find bookings where date is tomorrow
  const tomorrowStart = new Date(now);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  tomorrowStart.setHours(0, 0, 0, 0);

  const tomorrowEnd = new Date(tomorrowStart);
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

  const bookingsFor24h = await db.booking.findMany({
    where: {
      status: "CONFIRMED",
      date: {
        gte: tomorrowStart,
        lt: tomorrowEnd,
      },
      reminder24SentAt: null,
    },
    include: {
      user: { select: { phone: true, name: true } },
      courtConfig: { select: { sport: true } },
      slots: { orderBy: { startHour: "asc" }, take: 1 },
    },
  });

  for (const booking of bookingsFor24h) {
    try {
      if (!booking.user.phone) continue;
      if (booking.slots.length === 0) continue;

      const startHour = booking.slots[0].startHour;
      const sportName =
        SPORT_INFO[booking.courtConfig.sport]?.name ||
        booking.courtConfig.sport;
      const timeStr = formatHourRangeCompact(startHour);

      const message = `Reminder: Your ${sportName} booking at Momentum Arena is tomorrow at ${timeStr}. Booking ID: ${booking.id}`;

      const sent = await sendSmsReminder(booking.user.phone, message);

      // Push goes out alongside SMS — best-effort, doesn't gate the
      // 24h-sent state. If push fails the user still gets the SMS.
      void sendPushReminder(
        booking.userId,
        booking.id,
        "booking_reminder_24h",
        `${sportName} tomorrow at ${timeStr}`,
        "See you at Momentum Arena.",
      );

      if (sent) {
        await db.booking.update({
          where: { id: booking.id },
          data: { reminder24SentAt: new Date() },
        });
        results.sent24h++;
      } else {
        results.errors++;
      }
    } catch (error) {
      console.error(`Failed to send 24h reminder for booking ${booking.id}:`, error);
      results.errors++;
    }
  }

  // -- 2-hour reminders --
  // Find bookings happening today within the next ~2 hours
  const todayDate = new Date(now);
  todayDate.setHours(0, 0, 0, 0);

  const todayEnd = new Date(todayDate);
  todayEnd.setDate(todayEnd.getDate() + 1);

  // Current hour + 2 (the slot starting in approximately 2 hours)
  const targetHour = now.getHours() + 2;

  const bookingsFor2h = await db.booking.findMany({
    where: {
      status: "CONFIRMED",
      date: {
        gte: todayDate,
        lt: todayEnd,
      },
      reminder2SentAt: null,
      reminder24SentAt: { not: null }, // Only send 2h reminder if 24h was already sent (or skip for same-day bookings)
    },
    include: {
      user: { select: { phone: true, name: true } },
      courtConfig: { select: { sport: true } },
      slots: { orderBy: { startHour: "asc" }, take: 1 },
    },
  });

  for (const booking of bookingsFor2h) {
    try {
      if (!booking.user.phone) continue;
      if (booking.slots.length === 0) continue;

      const startHour = booking.slots[0].startHour;

      // Only send if the booking starts in the next 2-3 hours
      if (startHour !== targetHour && startHour !== targetHour + 1) continue;

      const sportName =
        SPORT_INFO[booking.courtConfig.sport]?.name ||
        booking.courtConfig.sport;
      const timeStr = formatHourRangeCompact(startHour);

      const message = `Your ${sportName} booking at Momentum Arena starts in 2 hours at ${timeStr}. Court ready for you!`;

      const sent = await sendSmsReminder(booking.user.phone, message);

      void sendPushReminder(
        booking.userId,
        booking.id,
        "booking_reminder_2h",
        `${sportName} in 2 hours`,
        `Tap to view your booking. ${timeStr}.`,
      );

      if (sent) {
        await db.booking.update({
          where: { id: booking.id },
          data: { reminder2SentAt: new Date() },
        });
        results.sent2h++;
      } else {
        results.errors++;
      }
    } catch (error) {
      console.error(`Failed to send 2h reminder for booking ${booking.id}:`, error);
      results.errors++;
    }
  }

  return results;
}
