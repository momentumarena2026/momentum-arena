"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const profileSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
});

export interface ProfileState {
  success: boolean;
  error?: string;
}

export async function updateProfile(data: {
  name: string;
  email?: string;
  phone?: string;
}): Promise<ProfileState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  const parsed = profileSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Invalid data" };
  }

  const { name, email, phone } = parsed.data;

  // Check uniqueness for email
  if (email) {
    const existing = await db.user.findFirst({
      where: { email, id: { not: session.user.id } },
    });
    if (existing) return { success: false, error: "Email is already in use by another account" };
  }

  // Check uniqueness for phone
  if (phone) {
    const existing = await db.user.findFirst({
      where: { phone, id: { not: session.user.id } },
    });
    if (existing) return { success: false, error: "Phone number is already in use by another account" };
  }

  await db.user.update({
    where: { id: session.user.id },
    data: {
      name,
      ...(email !== undefined && { email: email || null }),
      ...(phone !== undefined && { phone: phone || null }),
    },
  });

  return { success: true };
}

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
