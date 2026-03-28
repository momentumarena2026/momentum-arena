"use server";

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function submitFeedback(data: {
  bookingId: string;
  rating: number;
  comment?: string;
  tags: string[];
}) {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Not logged in" };

  if (data.rating < 1 || data.rating > 5) return { success: false, error: "Invalid rating" };

  const booking = await db.booking.findUnique({
    where: { id: data.bookingId, userId: session.user.id, status: "CONFIRMED" },
    include: { feedback: true },
  });

  if (!booking) return { success: false, error: "Booking not found" };
  if (booking.feedback) return { success: false, error: "Feedback already submitted" };

  await db.feedback.create({
    data: {
      bookingId: data.bookingId,
      userId: session.user.id,
      rating: data.rating,
      comment: data.comment?.trim() || null,
      tags: data.tags,
    },
  });

  revalidatePath(`/bookings/${data.bookingId}/feedback`);
  revalidatePath("/bookings");
  return { success: true };
}

export async function getFeedbackForBooking(bookingId: string) {
  return db.feedback.findUnique({ where: { bookingId } });
}

export async function getAverageFeedbackStats() {
  const result = await db.feedback.aggregate({
    _avg: { rating: true },
    _count: { id: true },
  });
  return {
    averageRating: result._avg.rating ?? 0,
    totalFeedbacks: result._count.id,
  };
}
