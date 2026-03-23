import { db } from "./db";
import { formatHour, SPORT_INFO, SIZE_INFO } from "./court-config";
import { formatPrice } from "./pricing";

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;

interface BookingDetails {
  id: string;
  userName: string;
  userEmail: string | null;
  userPhone: string | null;
  sport: string;
  configSize: string;
  configLabel: string;
  date: string;
  slots: { startHour: number; price: number }[];
  totalAmount: number;
  paymentMethod: string;
}

async function getBookingDetails(
  bookingId: string
): Promise<BookingDetails | null> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      user: true,
      courtConfig: true,
      slots: { orderBy: { startHour: "asc" } },
      payment: true,
    },
  });
  if (!booking) return null;

  return {
    id: booking.id,
    userName: booking.user.name || "Player",
    userEmail: booking.user.email,
    userPhone: booking.user.phone,
    sport: booking.courtConfig.sport,
    configSize: booking.courtConfig.size,
    configLabel: booking.courtConfig.label,
    date: booking.date.toLocaleDateString("en-IN", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    slots: booking.slots.map((s) => ({
      startHour: s.startHour,
      price: s.price,
    })),
    totalAmount: booking.totalAmount,
    paymentMethod: booking.payment?.method || "CASH",
  };
}

// Send booking confirmation via all channels
export async function sendBookingConfirmation(
  bookingId: string
): Promise<void> {
  const details = await getBookingDetails(bookingId);
  if (!details) return;

  const promises: Promise<void>[] = [];

  if (details.userEmail) {
    promises.push(sendEmailConfirmation(bookingId, details));
  }
  if (details.userPhone) {
    promises.push(sendSmsConfirmation(bookingId, details));
  }
  promises.push(logInAppNotification(bookingId));

  await Promise.allSettled(promises);
}

async function sendEmailConfirmation(
  bookingId: string,
  details: BookingDetails
): Promise<void> {
  if (!MSG91_AUTH_KEY || !details.userEmail) {
    await logNotification(bookingId, "email", "skipped", "No MSG91 key or email");
    return;
  }

  const sportInfo = SPORT_INFO[details.sport as keyof typeof SPORT_INFO];
  const sizeInfo = SIZE_INFO[details.configSize as keyof typeof SIZE_INFO];
  const slotTimes = details.slots
    .map((s) => formatHour(s.startHour))
    .join(", ");

  try {
    const response = await fetch(
      "https://control.msg91.com/api/v5/email/send",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authkey: MSG91_AUTH_KEY,
        },
        body: JSON.stringify({
          to: [{ email: details.userEmail, name: details.userName }],
          from: {
            email: "bookings@momentumarena.in",
            name: "Momentum Arena",
          },
          subject: `Booking Confirmed - ${sportInfo?.name || details.sport} on ${details.date}`,
          body: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #10b981;">Booking Confirmed!</h2>
              <p>Hi ${details.userName},</p>
              <p>Your booking at Momentum Arena has been confirmed.</p>
              <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Sport</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${sportInfo?.name || details.sport}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Court</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${details.configLabel} (${sizeInfo?.name || details.configSize})</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Date</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${details.date}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Time</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${slotTimes}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Total</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${formatPrice(details.totalAmount)}</td></tr>
                <tr><td style="padding: 8px; font-weight: bold;">Payment</td><td style="padding: 8px;">${details.paymentMethod.replace("_", " ")}</td></tr>
              </table>
              <p>Booking ID: <strong>${details.id}</strong></p>
              <p style="color: #666; font-size: 14px;">For any queries, contact us on WhatsApp: +91 6396 177 261</p>
            </div>
          `,
        }),
      }
    );

    if (response.ok) {
      await logNotification(bookingId, "email", "sent");
    } else {
      const err = await response.text();
      await logNotification(bookingId, "email", "failed", err);
    }
  } catch (error) {
    await logNotification(
      bookingId,
      "email",
      "failed",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

async function sendSmsConfirmation(
  bookingId: string,
  details: BookingDetails
): Promise<void> {
  // SMS via MSG91 requires DLT registration — stub for now
  await logNotification(
    bookingId,
    "sms",
    "skipped",
    "SMS requires DLT registration"
  );
}

async function logInAppNotification(bookingId: string): Promise<void> {
  await logNotification(bookingId, "in_app", "sent");
}

async function logNotification(
  bookingId: string,
  channel: string,
  status: string,
  error?: string
): Promise<void> {
  await db.notification.create({
    data: {
      bookingId,
      channel,
      status,
      sentAt: status === "sent" ? new Date() : null,
      error: error || null,
    },
  });
}
