import { db } from "./db";
import { formatBookingDate } from "./pricing";
import { formatHour, SPORT_INFO } from "./court-config";

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const MSG91_BOOKING_CONFIRMATION_TEMPLATE_ID =
  process.env.MSG91_BOOKING_CONFIRMATION_TEMPLATE_ID || "";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://momentumarena.com";

interface BookingDetails {
  id: string;
  userName: string;
  userEmail: string | null;
  userPhone: string | null;
  sport: string;
  configSize: string;
  configLabel: string;
  date: Date;
  dateFormatted: string;
  slots: { startHour: number; price: number }[];
  totalAmount: number;
  paymentMethod: string;
  qrToken: string | null;
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
    date: booking.date,
    dateFormatted: formatBookingDate(booking.date, {
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
    qrToken: booking.qrToken,
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

// --- Build confirmation message variables for MSG91 Flow template ---

function buildConfirmationVariables(details: BookingDetails) {
  const sportName =
    SPORT_INFO[details.sport as keyof typeof SPORT_INFO]?.name || details.sport;

  const timeSlots = details.slots
    .map((s) => formatHour(s.startHour))
    .join(", ");

  const confirmationUrl = `${APP_URL}/book/confirmation/${details.id}`;

  const amountStr = `Rs.${details.totalAmount.toLocaleString("en-IN")}`;

  return {
    customer_name: details.userName,
    sport: sportName,
    court: details.configLabel,
    date: details.dateFormatted,
    time: timeSlots,
    amount: amountStr,
    booking_id: details.id,
    confirmation_url: confirmationUrl,
  };
}

// --- Send confirmation via MSG91 Flow API ---

async function sendSmsConfirmation(
  bookingId: string,
  details: BookingDetails
): Promise<void> {
  if (!MSG91_AUTH_KEY || !MSG91_BOOKING_CONFIRMATION_TEMPLATE_ID) {
    // Log for dev / when template not configured
    const vars = buildConfirmationVariables(details);
    console.log(
      `\n📩 [DEV] Booking Confirmation for ${details.userPhone}:`,
      JSON.stringify(vars, null, 2),
      "\n"
    );
    await logNotification(
      bookingId,
      "sms",
      "skipped",
      "MSG91 booking confirmation template not configured"
    );
    return;
  }

  try {
    const vars = buildConfirmationVariables(details);

    const response = await fetch("https://control.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: MSG91_AUTH_KEY,
      },
      body: JSON.stringify({
        template_id: MSG91_BOOKING_CONFIRMATION_TEMPLATE_ID,
        recipients: [
          {
            mobiles: details.userPhone!.replace("+", ""),
            ...vars,
          },
        ],
      }),
    });

    const data = await response.json();
    console.log("MSG91 booking confirmation response:", JSON.stringify(data));

    if (data.type === "success") {
      await logNotification(bookingId, "sms", "sent");
    } else {
      await logNotification(
        bookingId,
        "sms",
        "failed",
        data.message || "MSG91 send failed"
      );
    }
  } catch (error) {
    console.error("MSG91 booking confirmation error:", error);
    await logNotification(
      bookingId,
      "sms",
      "failed",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
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
