"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { UserRole } from "@prisma/client";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    throw new Error("Unauthorized");
  }
  return session.user.id;
}

export async function getAdminUsers(filters?: {
  search?: string;
  role?: string;
  page?: number;
  limit?: number;
  showDeleted?: boolean;
}) {
  await requireAdmin();

  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 20;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};

  if (!filters?.showDeleted) {
    where.deletedAt = null;
  }

  if (filters?.role && ["CUSTOMER", "ADMIN"].includes(filters.role)) {
    where.role = filters.role as UserRole;
  }

  if (filters?.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { email: { contains: filters.search, mode: "insensitive" } },
      { phone: { contains: filters.search } },
    ];
  }

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        deletedAt: true,
        createdAt: true,
        _count: { select: { bookings: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    db.user.count({ where }),
  ]);

  return { users, total, page, totalPages: Math.ceil(total / limit) };
}

const createUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  role: z.enum(["CUSTOMER", "ADMIN"]),
});

export async function createUser(data: {
  name: string;
  email?: string;
  phone?: string;
  role: UserRole;
}) {
  await requireAdmin();

  const parsed = createUserSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Invalid data" };
  }

  const { name, email, phone, role } = parsed.data;

  if (!email && !phone) {
    return { success: false, error: "Email or phone is required" };
  }

  // Check uniqueness
  if (email) {
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) return { success: false, error: "Email already exists" };
  }
  if (phone) {
    const existing = await db.user.findUnique({ where: { phone } });
    if (existing) return { success: false, error: "Phone already exists" };
  }

  await db.user.create({
    data: {
      name,
      email: email || null,
      phone: phone || null,
      role,
    },
  });

  return { success: true };
}

export async function updateUser(
  userId: string,
  data: { name?: string; email?: string; phone?: string; role?: UserRole }
) {
  await requireAdmin();

  // Check uniqueness for email/phone changes
  if (data.email) {
    const existing = await db.user.findFirst({
      where: { email: data.email, id: { not: userId } },
    });
    if (existing) return { success: false, error: "Email already in use" };
  }
  if (data.phone) {
    const existing = await db.user.findFirst({
      where: { phone: data.phone, id: { not: userId } },
    });
    if (existing) return { success: false, error: "Phone already in use" };
  }

  await db.user.update({
    where: { id: userId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.email !== undefined && { email: data.email || null }),
      ...(data.phone !== undefined && { phone: data.phone || null }),
      ...(data.role !== undefined && { role: data.role }),
    },
  });

  return { success: true };
}

export async function deleteUser(userId: string) {
  const adminId = await requireAdmin();

  if (userId === adminId) {
    return { success: false, error: "Cannot delete yourself" };
  }

  // Check for active bookings
  const activeBookings = await db.booking.count({
    where: {
      userId,
      status: { in: ["CONFIRMED", "LOCKED"] },
    },
  });

  if (activeBookings > 0) {
    return {
      success: false,
      error: `User has ${activeBookings} active booking(s). Cancel them first.`,
    };
  }

  await db.user.update({
    where: { id: userId },
    data: { deletedAt: new Date() },
  });

  return { success: true };
}

export async function restoreUser(userId: string) {
  await requireAdmin();

  await db.user.update({
    where: { id: userId },
    data: { deletedAt: null },
  });

  return { success: true };
}
