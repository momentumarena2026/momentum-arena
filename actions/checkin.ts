"use server";

import { db } from "@/lib/db";
import { adminAuth } from "@/lib/admin-auth-session";
import { revalidatePath } from "next/cache";

export async function getBookingByQrToken(qrToken: string) {
  const booking = await db.booking.findUnique({
    where: { qrToken },
    include: {
      user: { select: { name: true, email: true, phone: true } },
      courtConfig: true,
      slots: { orderBy: { startHour: "asc" } },
      payment: true,
    },
  });
  return booking;
}

export async function markCheckedIn(qrToken: string) {
  const session = await adminAuth();
  if (!session?.user) return { success: false, error: "Unauthorized" };

  const booking = await db.booking.findUnique({ where: { qrToken } });
  if (!booking) return { success: false, error: "Booking not found" };
  if (booking.status !== "CONFIRMED") return { success: false, error: "Booking is not confirmed" };
  if (booking.checkedInAt) return { success: false, error: "Already checked in" };

  await db.booking.update({
    where: { qrToken },
    data: { checkedInAt: new Date() },
  });

  revalidatePath(`/admin/checkin`);
  return { success: true };
}
