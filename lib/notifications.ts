import { db } from "./db";
import { formatHoursAsRanges } from "./court-config";
import { normalizeIndianPhone } from "./phone";

// Parse + normalize + de-duplicate the admin phone list from env. Without
// this, "+919876543210" and "919876543210" in the same env string both
// end up as distinct recipients, which is what caused admins to receive
// two copies of every booking-confirmed SMS. A Set keyed by the
// normalized form collapses all representation variants to one.
function parseAdminPhones(): string[] {
  const raw = process.env.ADMIN_NOTIFICATION_PHONES || "";
  const seen = new Set<string>();
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    seen.add(normalizeIndianPhone(trimmed));
  }
  return Array.from(seen);
}

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const MSG91_BOOKING_CONFIRMATION_TEMPLATE_ID =
  process.env.MSG91_BOOKING_CONFIRMATION_TEMPLATE_ID || "69dfa7116edf7c748a0d4612";
// Existing "new booking, payment pending" admin template.
const MSG91_ADMIN_PENDING_BOOKING_TEMPLATE_ID =
  process.env.MSG91_ADMIN_PENDING_BOOKING_TEMPLATE_ID || "69dfa786ec69c7286e0d2082";
// Option B admin template: "New confirmed booking on {#var#}. Amount
// {#var#}. Details: https://www.momentumarena.com/admin/bookings - Momentum
// Arena". Separate env var so we don't reuse the pending-booking template
// id by mistake.
const MSG91_ADMIN_BOOKING_CONFIRMED_TEMPLATE_ID =
  process.env.MSG91_ADMIN_BOOKING_CONFIRMED_TEMPLATE_ID || "69e49a7f502b4be32e008982";
// NOTE: parsed lazily via parseAdminPhones() so env tweaks + normalization
// + de-duplication are all handled in one place.
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
      signal: AbortSignal.timeout(5000),
      headers: {
        "Content-Type": "application/json",
        authkey: MSG91_AUTH_KEY,
      },
      body: JSON.stringify({
        template_id: MSG91_BOOKING_CONFIRMATION_TEMPLATE_ID,
        recipients: [
          {
            mobiles: normalizeIndianPhone(details.userPhone!),
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

  const adminPhones = parseAdminPhones();

  if (adminPhones.length === 0) {
    console.log(
      `[DEV] No admin phones configured. Skipping admin notification for booking ${bookingId}`
    );
    return;
  }

  // Deep-links straight to the admin unconfirmed-bookings list so the on-call
  // admin jumps to the exact queue needing action. Uses the canonical
  // www.momentumarena.com host since that's what's whitelisted in DLT for
  // this SMS template's CTA.
  const adminPanelUrl =
    "https://www.momentumarena.com/admin/bookings/unconfirmed";

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
      mobiles: phone,
      name: details.userName,
      url: adminPanelUrl,
    }));

    const response = await fetch("https://control.msg91.com/api/v5/flow/", {
      method: "POST",
      signal: AbortSignal.timeout(5000),
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

// ---------------------------------------------------------------------------
// notifyAdminBookingConfirmed
// ---------------------------------------------------------------------------
// DLT template (2 variables):
//  "New confirmed booking on ##date##. Amount ##amount##. Details:
//   https://www.momentumarena.com/admin/bookings - Momentum Arena"
//
// Recipient payload keys MUST match the template variable names exactly
// (MSG91 Flow substitutes by key), so we send `date` and `amount`:
//   date   — date + time, e.g. "17 Apr 6pm-7pm"
//   amount — e.g. "Rs.1600"
//
// Template id is hard-coded as a default; an env override is still
// respected for dev/staging.
export async function notifyAdminBookingConfirmed(
  bookingId: string
): Promise<void> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      slots: { orderBy: { startHour: "asc" } },
    },
  });
  if (!booking) return;

  const adminPhones = parseAdminPhones();
  if (adminPhones.length === 0) return;

  // Build "17 Apr 6pm-7pm" — fits under DLT's 30-char variable limit for
  // typical bookings. Use IST so the date matches the venue timezone.
  const dateLabel = booking.date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
  const timeLabel =
    booking.slots.length > 0
      ? formatHoursAsRanges(booking.slots.map((s) => s.startHour))
      : "";
  const date = [dateLabel, timeLabel].filter(Boolean).join(" ").trim();

  const amount = `Rs.${booking.totalAmount.toLocaleString("en-IN")}`;

  if (!MSG91_AUTH_KEY || !MSG91_ADMIN_BOOKING_CONFIRMED_TEMPLATE_ID) {
    console.log(
      `\n[DEV] Admin Booking Confirmed SMS (template id not yet set):`,
      `\n  date: ${date}`,
      `\n  amount: ${amount}`,
      `\n  to: ${adminPhones.join(", ")}\n`
    );
    return;
  }

  try {
    const recipients = adminPhones.map((phone) => ({
      mobiles: phone,
      date,
      amount,
    }));

    const response = await fetch("https://control.msg91.com/api/v5/flow/", {
      method: "POST",
      signal: AbortSignal.timeout(5000),
      headers: {
        "Content-Type": "application/json",
        authkey: MSG91_AUTH_KEY,
      },
      body: JSON.stringify({
        template_id: MSG91_ADMIN_BOOKING_CONFIRMED_TEMPLATE_ID,
        recipients,
      }),
    });

    const data = await response.json();
    console.log("MSG91 admin booking confirmed response:", JSON.stringify(data));
  } catch (error) {
    console.error("MSG91 admin booking confirmed notification error:", error);
  }
}
