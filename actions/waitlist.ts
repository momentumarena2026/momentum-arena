"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeIndianPhone } from "@/lib/phone";
import { formatBookingDate } from "@/lib/pricing";
import { sendToUser } from "@/lib/push";

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
// DLT-approved template baked in as the default — keeps SMS working
// without an env var change. Set MSG91_WAITLIST_TEMPLATE_ID in env
// to override (useful if you want a different template in
// dev/staging vs prod). The template body is documented in the
// commit that introduced the 2-variable shape:
//
//   "Hi {{name}}, {{slot}} just opened up at Momentum Arena. Book
//    quickly before someone else grabs it. - Momentum Arena"
const MSG91_WAITLIST_TEMPLATE_ID =
  process.env.MSG91_WAITLIST_TEMPLATE_ID || "69f73490fb5c4a5b7e0c9083";

export interface WaitlistResult {
  success: boolean;
  error?: string;
  waitlistId?: string;
}

// ---------- Public actions ----------

export async function joinWaitlist(data: {
  courtConfigId: string;
  date: string; // ISO date string (YYYY-MM-DD)
  startHour: number;
  endHour: number;
  guestPhone?: string;
  guestEmail?: string;
  // Mobile routes pre-authenticate via JWT and pass the user id here
  // so we don't require a NextAuth web cookie. Web call sites omit
  // and we fall back to auth().
  userIdOverride?: string;
}): Promise<WaitlistResult> {
  const session = data.userIdOverride
    ? { user: { id: data.userIdOverride } }
    : await auth();

  // Either logged in OR guest contact required.
  if (!session?.user?.id && !data.guestPhone && !data.guestEmail) {
    return {
      success: false,
      error: "Please sign in or provide a phone/email to join the waitlist",
    };
  }

  const { courtConfigId, date, startHour, endHour, guestPhone, guestEmail } =
    data;

  if (startHour >= endHour) {
    return { success: false, error: "Invalid time range" };
  }

  const bookingDate = new Date(date);
  bookingDate.setHours(0, 0, 0, 0);

  // Expire the entry the moment the slot itself starts. Once the
  // slot has begun, "we'll notify you if it opens up" stops making
  // sense — the user can't book a slot that's already underway.
  const expiresAt = new Date(bookingDate);
  expiresAt.setHours(startHour, 0, 0, 0);

  if (expiresAt.getTime() <= Date.now()) {
    return {
      success: false,
      error: "This slot has already started — can't join the waitlist",
    };
  }

  // Per-user dedupe: one active entry per (user, court, date, hours).
  // Without this a spam-tap creates many WAITING rows and the user
  // gets duplicate notifications when the slot opens.
  if (session?.user?.id) {
    const existing = await db.waitlist.findFirst({
      where: {
        userId: session.user.id,
        courtConfigId,
        date: bookingDate,
        startHour,
        endHour,
        status: "WAITING",
      },
    });

    if (existing) {
      return {
        success: false,
        error: "You're already on the waitlist for this slot",
      };
    }
  }

  const courtConfig = await db.courtConfig.findUnique({
    where: { id: courtConfigId },
  });

  if (!courtConfig) {
    return { success: false, error: "Court not found" };
  }

  // Store guest phone canonicalised so the notify path doesn't have
  // to re-normalize and can't accidentally blast a 10-digit number
  // without country code.
  const guestPhoneNormalized = guestPhone
    ? normalizeIndianPhone(guestPhone)
    : null;

  const entry = await db.waitlist.create({
    data: {
      userId: session?.user?.id || null,
      guestPhone: guestPhoneNormalized,
      guestEmail: guestEmail || null,
      courtConfigId,
      date: bookingDate,
      startHour,
      endHour,
      status: "WAITING",
      expiresAt,
    },
  });

  return { success: true, waitlistId: entry.id };
}

export async function cancelWaitlist(
  waitlistId: string,
  userIdOverride?: string,
): Promise<WaitlistResult> {
  const userId = userIdOverride ?? (await auth())?.user?.id;
  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  const entry = await db.waitlist.findUnique({
    where: { id: waitlistId },
  });

  if (!entry) {
    return { success: false, error: "Waitlist entry not found" };
  }

  if (entry.userId !== userId) {
    return { success: false, error: "Unauthorized" };
  }

  if (entry.status !== "WAITING" && entry.status !== "NOTIFIED") {
    return { success: false, error: "Cannot cancel this waitlist entry" };
  }

  await db.waitlist.update({
    where: { id: waitlistId },
    data: { status: "CANCELLED" },
  });

  return { success: true };
}

export async function getUserWaitlist(userIdOverride?: string) {
  const userId = userIdOverride ?? (await auth())?.user?.id;
  if (!userId) {
    return { success: false, error: "Not authenticated", entries: [] };
  }

  const entries = await db.waitlist.findMany({
    where: {
      userId,
      status: { in: ["WAITING", "NOTIFIED"] },
      expiresAt: { gt: new Date() },
    },
    include: {
      courtConfig: {
        select: { id: true, sport: true, size: true, label: true },
      },
    },
    orderBy: [{ date: "asc" }, { startHour: "asc" }],
  });

  return { success: true, entries };
}

// ---------- Server-side fan-out (called from cancel/refund/edit-slot) ----------

interface FreedSlot {
  courtConfigId: string;
  date: Date;
  hours: number[]; // freed hours on that date
}

/**
 * Fire-and-forget entry point used by the booking-mutation actions.
 *
 * For every WAITING waitlister whose declared range overlaps any of
 * the freed hours, we:
 *   1. Mark the entry NOTIFIED (so the next freeing doesn't double-ping)
 *   2. Fan out push + SMS + email to the user/guest in parallel
 *
 * "First-to-book wins" is enforced naturally by the existing 10-min
 * slot lock, so we deliberately notify EVERY matching waitlister at
 * once rather than ranking them. The race is fair and the slot lock
 * prevents double-booking.
 */
export async function notifyWaitlistersForFreedSlots(
  freed: FreedSlot
): Promise<void> {
  if (freed.hours.length === 0) return;

  const dateStart = startOfDay(freed.date);
  const dateEnd = endOfDay(freed.date);

  // Find every WAITING entry on this court+date whose [startHour,
  // endHour) range covers AT LEAST ONE of the freed hours. We do this
  // as a single query (not a per-hour loop) so a multi-hour cancel
  // results in one DB round-trip, not N.
  const minFreed = Math.min(...freed.hours);
  const maxFreed = Math.max(...freed.hours);

  const candidates = await db.waitlist.findMany({
    where: {
      courtConfigId: freed.courtConfigId,
      date: { gte: dateStart, lt: dateEnd },
      status: "WAITING",
      expiresAt: { gt: new Date() },
      // Range overlap pre-filter: entry covers some freed hour iff
      // entry.startHour <= maxFreed AND entry.endHour >= minFreed + 1.
      // Refined per-entry check below.
      startHour: { lte: maxFreed },
      endHour: { gte: minFreed + 1 },
    },
    include: {
      user: {
        select: { id: true, phone: true, name: true },
      },
      courtConfig: {
        select: { id: true, sport: true, label: true },
      },
    },
  });

  // Refined per-entry overlap (pre-filter is by min/max so multi-
  // hour windows with gaps could still fail real overlap).
  const matching = candidates.filter((entry) =>
    freed.hours.some(
      (h) => entry.startHour <= h && entry.endHour >= h + 1,
    ),
  );

  if (matching.length === 0) return;

  // Mark them all NOTIFIED in one round-trip before we fan out, so
  // even if the notification dispatch is slow we don't double-ping
  // anyone if a second cancel lands during the loop.
  const now = new Date();
  await db.waitlist.updateMany({
    where: { id: { in: matching.map((m) => m.id) } },
    data: { status: "NOTIFIED", notifiedAt: now },
  });

  // Fan out in parallel — failures in any single channel don't
  // block the others, and a failed dispatch to one waitlister
  // doesn't block the rest.
  await Promise.allSettled(
    matching.map((entry) =>
      dispatchSlotAvailableNotification(entry).catch((err) =>
        console.error("[waitlist] notify failed for entry", entry.id, err),
      ),
    ),
  );
}

// ---------- Notification dispatch (push + SMS) ----------

type WaitlistEntryWithRelations = Awaited<
  ReturnType<typeof db.waitlist.findMany>
>[number] & {
  user: { id: string; phone: string | null; name: string | null } | null;
  courtConfig: { id: string; sport: string; label: string };
};

async function dispatchSlotAvailableNotification(
  entry: WaitlistEntryWithRelations,
): Promise<void> {
  const dateStr = formatBookingDate(entry.date, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const timeStr = formatHourRange(entry.startHour, entry.endHour);
  const sport = capitalise(
    entry.courtConfig.sport.replace(/_/g, " ").toLowerCase(),
  );
  const courtLabel = entry.courtConfig.label;
  const recipientName = entry.user?.name?.trim() || "there";

  // Single combined "slot" string used for both the push body and the
  // SMS template variable. Keeping the wording identical across
  // channels avoids confusion when a user gets both notifications
  // about the same slot.
  const slotLine = `${sport} at ${courtLabel} on ${dateStr} ${timeStr}`;

  // 1. Push (logged-in users only — guests have no device token).
  if (entry.userId) {
    try {
      await sendToUser(entry.userId, {
        title: "A slot just opened up",
        body: `${slotLine} just opened up. Book now before someone else grabs it.`,
        data: {
          kind: "slot_available",
          waitlistId: entry.id,
          courtConfigId: entry.courtConfigId,
          date: toYMD(entry.date),
          startHour: String(entry.startHour),
          endHour: String(entry.endHour),
        },
      });
    } catch (err) {
      console.error("[waitlist] push failed for", entry.id, err);
    }
  }

  // 2. SMS — prefer logged-in user.phone, fall back to guestPhone.
  // The recipient object's keys map 1:1 to variables in the
  // DLT-approved MSG91 template — see sendWaitlistSms below.
  const phone = entry.user?.phone || entry.guestPhone;
  if (phone) {
    void sendWaitlistSms({
      phone,
      name: recipientName,
      slot: slotLine,
    });
  }
}

/**
 * Fires a single waitlist SMS via MSG91 Flow API.
 *
 * Two variables only — DLT-friendly. The template body registered
 * with TRAI must use {{name}} + {{slot}} (or the ##VAR## form,
 * depending on which template version was approved):
 *
 *   "Hi {{name}}, {{slot}} just opened up at Momentum Arena. Book
 *    quickly before someone else grabs it. - Momentum Arena"
 *
 * Keep this signature in sync with the approved template.
 */
async function sendWaitlistSms(opts: {
  phone: string;
  name: string;
  slot: string;
}): Promise<void> {
  const { phone, name, slot } = opts;

  if (!MSG91_AUTH_KEY || !MSG91_WAITLIST_TEMPLATE_ID) {
    console.log(
      `[DEV] Waitlist SMS to ${phone}: Hi ${name}, ${slot} just opened up.`,
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
        template_id: MSG91_WAITLIST_TEMPLATE_ID,
        recipients: [
          {
            mobiles: normalizeIndianPhone(phone),
            name,
            slot,
          },
        ],
      }),
    });
    if (!response.ok) {
      console.error(
        "[waitlist] SMS HTTP",
        response.status,
        await response.text(),
      );
    }
  } catch (err) {
    console.error("[waitlist] SMS error:", err);
  }
}

// ---------- Small helpers ----------

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() + 1);
  return x;
}

function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatHourRange(start: number, end: number): string {
  return `${formatHour(start)} – ${formatHour(end)}`;
}

function formatHour(h: number): string {
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ampm = h < 12 || h === 24 ? "AM" : "PM";
  return `${hour12}${ampm}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
