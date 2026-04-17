import { db } from "./db";

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const MSG91_BOOKING_CONFIRMATION_TEMPLATE_ID =
  process.env.MSG91_BOOKING_CONFIRMATION_TEMPLATE_ID || "69dfa7116edf7c748a0d4612";
const MSG91_ADMIN_PENDING_BOOKING_TEMPLATE_ID =
  process.env.MSG91_ADMIN_PENDING_BOOKING_TEMPLATE_ID || "69dfa786ec69c7286e0d2082";
const ADMIN_NOTIFICATION_PHONES =
  process.env.ADMIN_NOTIFICATION_PHONES || ""; // Comma-separated: "919876543210,919876543211"
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://momentumarena.com";

interface BookingDetails {
  id: string;
  userName: string;
  userPhone: string | null;
}

async function getBookingDetails(
  bookingId: string
): Promise<BookingDetails | null> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { user: { select: { name: true, phone: true } } },
  });
  if (!booking) return null;

  return {
    id: booking.id,
    userName: booking.user.name || "Player",
    userPhone: booking.user.phone,
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

// --- Send confirmation via MSG91 Flow API ---
// DLT template (2 variables only):
// "Dear {#var#}, your booking at Momentum Arena is confirmed.
//  View details, download invoice and get check-in QR here: {#var#}
//  - Momentum Arena, Mathura"

async function sendSmsConfirmation(
  bookingId: string,
  details: BookingDetails
): Promise<void> {
  // Query-string form so the URL base ("${APP_URL}/book/confirmation?") can
  // be whitelisted once in Airtel DLT and the bookingId varies as the
  // standard {#url#} query parameter. The legacy path form still works via a
  // redirect, but every new SMS uses this shape.
  const confirmationUrl = `${APP_URL}/book/confirmation?id=${details.id}`;

  if (!MSG91_AUTH_KEY || !MSG91_BOOKING_CONFIRMATION_TEMPLATE_ID) {
    console.log(
      `\n[DEV] Booking Confirmation SMS for ${details.userPhone}:`,
      `\n  customer_name: ${details.userName}`,
      `\n  confirmation_url: ${confirmationUrl}\n`
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
            name: details.userName,
            url: confirmationUrl,
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

// ─── Admin notification for pending bookings (UPI QR / Cash) ───

// DLT template (2 variables):
// "New booking received from {#var#} at Momentum Arena.
//  Payment pending verification. Check admin panel: {#var#}
//  - Momentum Arena"

export async function notifyAdminPendingBooking(
  bookingId: string
): Promise<void> {
  const details = await getBookingDetails(bookingId);
  if (!details) return;

  const adminPhones = ADMIN_NOTIFICATION_PHONES.split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  if (adminPhones.length === 0) {
    console.log(
      `[DEV] No admin phones configured. Skipping admin notification for booking ${bookingId}`
    );
    return;
  }

  const adminPanelUrl = `${APP_URL}/admin`;

  if (!MSG91_AUTH_KEY || !MSG91_ADMIN_PENDING_BOOKING_TEMPLATE_ID) {
    console.log(
      `\n[DEV] Admin Pending Booking SMS:`,
      `\n  customer_name: ${details.userName}`,
      `\n  admin_panel_url: ${adminPanelUrl}`,
      `\n  to: ${adminPhones.join(", ")}\n`
    );
    return;
  }

  try {
    const recipients = adminPhones.map((phone) => ({
      mobiles: phone.replace("+", ""),
      name: details.userName,
      url: adminPanelUrl,
    }));

    const response = await fetch("https://control.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: MSG91_AUTH_KEY,
      },
      body: JSON.stringify({
        template_id: MSG91_ADMIN_PENDING_BOOKING_TEMPLATE_ID,
        recipients,
      }),
    });

    const data = await response.json();
    console.log("MSG91 admin pending booking response:", JSON.stringify(data));
  } catch (error) {
    console.error("MSG91 admin pending booking notification error:", error);
  }
}
