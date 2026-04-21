"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeIndianPhone } from "@/lib/phone";

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

  // Normalize phone once here — the UI sends either the canonical
  // "91XXXXXXXXXX" from PhoneInput-wired flows, or legacy raw input.
  // Either way we store the canonical form so MSG91 gets a country
  // code prefix and duplicate-phone checks can't be bypassed by
  // submitting a different representation of the same number.
  const normalizedPhone = phone ? normalizeIndianPhone(phone) : "";
  if (normalizedPhone && (normalizedPhone.length !== 12 || !normalizedPhone.startsWith("91"))) {
    return { success: false, error: "Phone number must be a 10-digit Indian mobile number" };
  }

  // Check uniqueness for email
  if (email) {
    const existing = await db.user.findFirst({
      where: { email, id: { not: session.user.id } },
    });
    if (existing) return { success: false, error: "Email is already in use by another account" };
  }

  // Check uniqueness for phone
  if (normalizedPhone) {
    const existing = await db.user.findFirst({
      where: { phone: normalizedPhone, id: { not: session.user.id } },
    });
    if (existing) return { success: false, error: "Phone number is already in use by another account" };
  }

  await db.user.update({
    where: { id: session.user.id },
    data: {
      name,
      ...(email !== undefined && { email: email || null }),
      ...(phone !== undefined && { phone: normalizedPhone || null }),
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
