"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import type { AdminRole } from "@prisma/client";

/**
 * "My profile" — the signed-in admin edits their OWN account. Available to
 * every admin role (no permission gate beyond being authenticated).
 *
 * The mobile route resolves the caller's adminId from the bearer token
 * (getMobileAdmin) and passes it in explicitly, so these helpers take the id
 * as their first argument rather than reading a cookie session. The web
 * profile page can call the same helpers with the session admin's id.
 */

export interface AdminProfile {
  id: string;
  username: string;
  email: string;
  role: AdminRole;
  permissions: string[];
  lastLoginAt: string | null;
  createdAt: string;
}

export async function getAdminProfile(adminId: string): Promise<AdminProfile> {
  const admin = await db.adminUser.findUnique({
    where: { id: adminId },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      permissions: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });
  if (!admin) throw new Error("Admin account not found");
  return {
    ...admin,
    lastLoginAt: admin.lastLoginAt ? admin.lastLoginAt.toISOString() : null,
    createdAt: admin.createdAt.toISOString(),
  };
}

const ProfileSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers, and underscores",
    )
    .optional(),
  email: z.string().trim().email("Please enter a valid email").optional(),
  // Password change: both required together.
  currentPassword: z.string().optional(),
  newPassword: z.string().optional(),
});

export type UpdateAdminProfileInput = z.input<typeof ProfileSchema>;

export async function updateAdminProfile(
  adminId: string,
  input: UpdateAdminProfileInput,
): Promise<AdminProfile> {
  const parsed = ProfileSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);

  const admin = await db.adminUser.findUnique({ where: { id: adminId } });
  if (!admin) throw new Error("Admin account not found");

  const data: { username?: string; email?: string; passwordHash?: string } = {};

  if (parsed.data.username && parsed.data.username !== admin.username) {
    const clash = await db.adminUser.findFirst({
      where: { username: parsed.data.username, id: { not: adminId } },
    });
    if (clash) throw new Error("Username already taken");
    data.username = parsed.data.username;
  }

  if (parsed.data.email && parsed.data.email !== admin.email) {
    const clash = await db.adminUser.findFirst({
      where: { email: parsed.data.email, id: { not: adminId } },
    });
    if (clash) throw new Error("Email already in use");
    data.email = parsed.data.email;
  }

  const { currentPassword, newPassword } = parsed.data;
  if (newPassword || currentPassword) {
    if (!currentPassword || !newPassword) {
      throw new Error("Enter both your current and new password");
    }
    const valid = await verifyPassword(currentPassword, admin.passwordHash);
    if (!valid) throw new Error("Current password is incorrect");
    if (newPassword.length < 10) {
      throw new Error("New password must be at least 10 characters");
    }
    if (
      !/[a-zA-Z]/.test(newPassword) ||
      !/[0-9]/.test(newPassword) ||
      !/[^a-zA-Z0-9]/.test(newPassword)
    ) {
      throw new Error(
        "Password must contain letters, numbers, and a special character",
      );
    }
    data.passwordHash = await hashPassword(newPassword);
  }

  if (Object.keys(data).length > 0) {
    await db.adminUser.update({ where: { id: adminId }, data });
  }

  return getAdminProfile(adminId);
}
