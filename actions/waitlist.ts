"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;

async function sendWaitlistSms(
  phone: string,
  message: string
): Promise<boolean> {
  if (!MSG91_AUTH_KEY) {
    console.log(`[DEV] Waitlist SMS to ${phone}: ${message}`);
    return true;
  }

  try {
    const response = await fetch("https://control.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: MSG91_AUTH_KEY,
      },
      body: JSON.stringify({
        template_id: process.env.MSG91_WAITLIST_TEMPLATE_ID || "",
        recipients: [
          {
            mobiles: phone.replace("+", ""),
            message,
          },
        ],
      }),
    });

    const data = await response.json();
    return data.type === "success";
  } catch (error) {
    console.error("Waitlist SMS send error:", error);
    return false;
  }
}

export interface WaitlistResult {
  success: boolean;
  error?: string;
  waitlistId?: string;
}

export async function joinWaitlist(data: {
  courtConfigId: string;
  date: string; // ISO date string
  startHour: number;
  endHour: number;
  guestPhone?: string;
  guestEmail?: string;
}): Promise<WaitlistResult> {
  const session = await auth();

  // Must be logged in or provide guest contact
  if (!session?.user?.id && !data.guestPhone && !data.guestEmail) {
    return {
      success: false,
      error: "Please provide contact details or log in to join the waitlist",
    };
  }

  const { courtConfigId, date, startHour, endHour, guestPhone, guestEmail } =
    data;

  if (startHour >= endHour) {
    return { success: false, error: "Invalid time range" };
  }

  const bookingDate = new Date(date);
  bookingDate.setHours(0, 0, 0, 0);

  // Check if this user already has a WAITING entry for this slot
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
        error: "You are already on the waitlist for this slot",
      };
    }
  }

  // Verify the court config exists
  const courtConfig = await db.courtConfig.findUnique({
    where: { id: courtConfigId },
  });

  if (!courtConfig) {
    return { success: false, error: "Court not found" };
  }

  // Auto-expire after 48 hours
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 48);

  const entry = await db.waitlist.create({
    data: {
      userId: session?.user?.id || null,
      guestPhone: guestPhone || null,
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
  waitlistId: string
): Promise<WaitlistResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  const entry = await db.waitlist.findUnique({
    where: { id: waitlistId },
  });

  if (!entry) {
    return { success: false, error: "Waitlist entry not found" };
  }

  if (entry.userId !== session.user.id) {
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

export async function getUserWaitlist() {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated", entries: [] };
  }

  const entries = await db.waitlist.findMany({
    where: {
      userId: session.user.id,
      status: { in: ["WAITING", "NOTIFIED"] },
    },
    include: {
      courtConfig: {
        select: { sport: true, size: true, label: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return { success: true, entries };
}

/**
 * Called when a booking is cancelled - notifies the first WAITING entry for that slot.
 * This should be called from the booking cancellation action.
 */
export async function checkAndNotifyWaitlist(
  courtConfigId: string,
  date: Date,
  startHour: number,
  endHour: number
): Promise<void> {
  const dateStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
  const dateEnd = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1
  );

  // Find the first WAITING entry that overlaps this slot
  const entry = await db.waitlist.findFirst({
    where: {
      courtConfigId,
      date: { gte: dateStart, lt: dateEnd },
      startHour: { lte: endHour - 1 },
      endHour: { gte: startHour + 1 },
      status: "WAITING",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "asc" },
    include: {
      user: { select: { phone: true, name: true } },
      courtConfig: { select: { sport: true, label: true } },
    },
  });

  if (!entry) return;

  // Update status to NOTIFIED
  await db.waitlist.update({
    where: { id: entry.id },
    data: { status: "NOTIFIED", notifiedAt: new Date() },
  });

  // Send SMS to user or guest
  const phone = entry.user?.phone || entry.guestPhone;
  if (!phone) return;

  const dateStr = entry.date.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  const message = `Good news! A slot has opened up at Momentum Arena for ${entry.courtConfig.sport} on ${dateStr}. Book now before it's gone!`;

  await sendWaitlistSms(phone, message);
}
