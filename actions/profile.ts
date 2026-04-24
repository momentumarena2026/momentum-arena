"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function getProfile() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      image: true,
      role: true,
      emailVerified: true,
      phoneVerified: true,
      createdAt: true,
      _count: { select: { bookings: true } },
    },
  });

  return user;
}
