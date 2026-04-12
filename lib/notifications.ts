import { db } from "./db";
import { formatBookingDate } from "./pricing";

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
    date: formatBookingDate(booking.date, {
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

  if (details.userPhone) {
    promises.push(sendSmsConfirmation(bookingId, details));
  }
  promises.push(logInAppNotification(bookingId));

  await Promise.allSettled(promises);
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
