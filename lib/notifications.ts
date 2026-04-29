import { db } from "./db";
import { formatHoursAsRanges } from "./court-config";
import { normalizeIndianPhone } from "./phone";
import { sendToAdmins, sendToUser } from "./push";

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
  process.env.MSG91_BOOKING_CONFIRMATION_TEMPLATE_ID || "69e918a14983bc3b6a082835";
// Existing "new booking, payment pending" admin template (PhonePe QR unconfirmed).
const MSG91_ADMIN_PENDING_BOOKING_TEMPLATE_ID =
  process.env.MSG91_ADMIN_PENDING_BOOKING_TEMPLATE_ID || "69eb535ae5815fa1860a1044";
// Option B admin template: "New confirmed booking on {#var#}. Amount
// {#var#}. Details: https://www.momentumarena.com/admin/bookings - Momentum
// Arena". Separate env var so we don't reuse the pending-booking template
// id by mistake.
const MSG91_ADMIN_BOOKING_CONFIRMED_TEMPLATE_ID =
  process.env.MSG91_ADMIN_BOOKING_CONFIRMED_TEMPLATE_ID || "69e49a7f502b4be32e008982";
// NOTE: parsed lazily via parseAdminPhones() so env tweaks + normalization
// + de-duplication are all handled in one place.

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
  promises.push(sendPushConfirmation(bookingId));

  await Promise.allSettled(promises);
}

// FCM push for the booker. Best-effort — sendToUser silently no-ops
// when FCM isn't configured (preview deploys without the service
// account JSON) and prunes dead tokens automatically. We still log
// the attempt as an in-app `Notification` row keyed by `push` so
// admins can see whether the device fan-out happened.
async function sendPushConfirmation(bookingId: string): Promise<void> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { slots: { orderBy: { startHour: "asc" } } },
  });
  if (!booking) return;

  const dateLabel = booking.date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
  const timeLabel =
    booking.slots.length > 0
      ? formatHoursAsRanges(booking.slots.map((s) => s.startHour))
      : "";
  const when = [dateLabel, timeLabel].filter(Boolean).join(" ");

  try {
    const result = await sendToUser(booking.userId, {
      title: "Booking confirmed",
      body: when ? `Your slot on ${when} is locked in.` : "Your slot is locked in.",
      data: { kind: "booking_confirmed", bookingId },
    });
    await logNotification(
      bookingId,
      "push",
      result.succeeded > 0 ? "sent" : result.attempted === 0 ? "skipped" : "failed",
      result.attempted === 0
        ? "no registered devices"
        : result.failed > 0
          ? `${result.failed}/${result.attempted} failed`
          : undefined
    );
  } catch (error) {
    console.error("Push booking confirmation error:", error);
    await logNotification(
      bookingId,
      "push",
      "failed",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

// --- Send confirmation via MSG91 Flow API ---
// DLT template (2 variables):
// "Hi ##name##, your booking is confirmed.
//  Details: https://momentumarena.com/book/confirmation?id=##bookingid##
//  - Momentum Arena, Mathura"
//
// The URL base is baked into the template text itself; the variable is
// just the 25-char bookingId. This keeps us under the DLT 30-char
// per-variable max (earlier template sent the full ~72-char URL and was
// rejected with "DLT template variable exceeded max length").
// Variable names must match exactly: "name" and "bookingid" (lowercase,
// no underscore), since MSG91 Flow substitutes by key.

async function sendSmsConfirmation(
  bookingId: string,
  details: BookingDetails
): Promise<void> {
  if (!MSG91_AUTH_KEY || !MSG91_BOOKING_CONFIRMATION_TEMPLATE_ID) {
    console.log(
      `\n[DEV] Booking Confirmation SMS for ${details.userPhone}:`,
      `\n  name: ${details.userName}`,
      `\n  bookingid: ${details.id}\n`
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
            bookingid: details.id,
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

  // FCM fan-out to every signed-in admin device. Best-effort —
  // a missing service-account key just no-ops sendToAdmins. The
  // mobile shell tap handler routes this kind to the unconfirmed
  // queue. Runs in parallel with the SMS path below.
  void sendToAdmins({
    title: "New booking awaiting verification",
    body: `${details.userName} just booked — verify the screenshot or collect cash to confirm.`,
    data: {
      kind: "admin_pending_booking",
      bookingId,
    },
  }).catch((err) => console.error("[push] admin pending booking failed:", err));

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
      user: { select: { name: true, phone: true } },
    },
  });
  if (!booking) return;

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

  // FCM fan-out to admin devices. Tap routes to AdminBookingDetail.
  // Independent of the SMS path (which depends on the DLT template
  // env vars) so the mobile alert lands even when SMS isn't set up.
  const customerName = booking.user?.name?.trim() || "A customer";
  void sendToAdmins({
    title: "Booking confirmed",
    body: `${customerName} · ${date} · ${amount}`,
    data: {
      kind: "admin_booking_confirmed",
      bookingId,
    },
  }).catch((err) =>
    console.error("[push] admin booking confirmed failed:", err),
  );

  const adminPhones = parseAdminPhones();
  if (adminPhones.length === 0) return;

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

// ---------------------------------------------------------------------------
// notifyAdminBookingCancelled
// ---------------------------------------------------------------------------
// FCM-only (no SMS template for cancellations yet — adds bandwidth
// without obvious incremental value when admins are already in the
// loop on every cancel they initiate). Useful for the OTHER admins
// on the team who didn't trigger the cancel themselves: they see a
// banner, can tap into the booking, optionally reach out to the
// customer if there's context to capture.
//
// `refunded` flips the body copy to mention the refund — same call
// pattern admins use for cancelBooking vs refundBooking.

export async function notifyAdminBookingCancelled(
  bookingId: string,
  reason: string,
  refunded = false,
): Promise<void> {
  const details = await getBookingDetails(bookingId);
  if (!details) return;

  const trimmedReason = reason.trim();
  const body = refunded
    ? `${details.userName} · refund processed${trimmedReason ? ` — ${trimmedReason}` : ""}`
    : `${details.userName} cancelled${trimmedReason ? ` — ${trimmedReason}` : ""}`;

  void sendToAdmins({
    title: refunded ? "Booking refunded" : "Booking cancelled",
    body,
    data: {
      kind: "admin_booking_cancelled",
      bookingId,
      refunded: refunded ? "1" : "0",
    },
  }).catch((err) =>
    console.error("[push] admin booking cancelled failed:", err),
  );
}
