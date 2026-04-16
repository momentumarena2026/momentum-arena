"use server";

import { z } from "zod";
import crypto from "crypto";
import { AuthError } from "next-auth";
import { AdminRole } from "@prisma/client";
import { adminSignIn, adminSignOut } from "@/lib/admin-auth-session";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { requireSuperadmin } from "@/lib/admin-auth";
import { ALL_PERMISSIONS, SUPERADMIN_ONLY_PERMISSIONS } from "@/lib/permissions";
import {
  sendAdminInviteEmail,
  sendSuperadminPasswordNotification,
} from "@/lib/email";

export type AdminLoginState = {
  error?: string;
  success?: boolean;
};

export type AdminSetupState = {
  error?: string;
  success?: boolean;
};

// --- Admin Login ---

export async function adminLogin(
  _prevState: AdminLoginState,
  formData: FormData
): Promise<AdminLoginState> {
  const username = (formData.get("username") as string)?.trim();
  const password = formData.get("password") as string;
  const callbackUrl = (formData.get("callbackUrl") as string) || "/admin";

  if (!username || !password) {
    return { error: "Please enter username and password" };
  }

  // Rate limit: max 5 attempts per username per 15 minutes
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);
  const rateEntry = await db.rateLimit.findUnique({
    where: { identifier_action: { identifier: `admin:${username}`, action: "login" } },
  });
  if (rateEntry && rateEntry.windowStart > fifteenMinAgo && rateEntry.count >= 5) {
    return { error: "Too many login attempts. Please try again in 15 minutes." };
  }
  await db.rateLimit.upsert({
    where: { identifier_action: { identifier: `admin:${username}`, action: "login" } },
    create: { identifier: `admin:${username}`, action: "login", count: 1, windowStart: new Date() },
    update: rateEntry && rateEntry.windowStart > fifteenMinAgo
      ? { count: { increment: 1 } }
      : { count: 1, windowStart: new Date() },
  });

  try {
    // Only allow internal redirects (prevent open redirect)
    const safeRedirect = callbackUrl.startsWith("/") ? callbackUrl : "/admin";
    await adminSignIn("admin-credentials", {
      username,
      password,
      redirectTo: safeRedirect,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Invalid username or password." };
    }
    throw error; // re-throw redirect errors
  }

  return { success: true };
}

export async function adminLogout() {
  await adminSignOut({ redirectTo: "/godmode" });
}

// --- Admin User Management (Superadmin only) ---

const CreateAdminSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
  email: z.string().email("Please enter a valid email"),
  permissions: z.array(z.string()),
});

export async function createAdminUser(
  _prevState: { error?: string; success?: boolean },
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  await requireSuperadmin();

  const username = (formData.get("username") as string)?.trim();
  const email = (formData.get("email") as string)?.trim();
  const permissions = formData.getAll("permissions") as string[];
  const roleInput = (formData.get("role") as string)?.trim();
  const role = roleInput === "STAFF" ? "STAFF" : "ADMIN";

  const validated = CreateAdminSchema.safeParse({
    username,
    email,
    permissions,
  });
  if (!validated.success) {
    return { error: validated.error.issues[0].message };
  }

  // Check uniqueness
  const existing = await db.adminUser.findFirst({
    where: { OR: [{ username }, { email }] },
  });
  if (existing) {
    return {
      error:
        existing.username === username
          ? "Username already taken"
          : "Email already in use",
    };
  }

  // Filter out superadmin-only permissions for regular admins
  const filteredPermissions = permissions.filter(
    (p) => !SUPERADMIN_ONLY_PERMISSIONS.includes(p as never)
  );

  // Generate invite token
  const inviteToken = crypto.randomBytes(32).toString("hex");
  const inviteTokenExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

  // Create admin with a temporary password hash (will be replaced on setup)
  const tempHash = await hashPassword(crypto.randomBytes(32).toString("hex"));

  await db.adminUser.create({
    data: {
      username,
      email,
      passwordHash: tempHash,
      role: role as AdminRole,
      permissions: role === "STAFF" ? [] : filteredPermissions,
      inviteToken,
      inviteTokenExpiry,
    },
  });

  // Send invite email
  await sendAdminInviteEmail(email, username, inviteToken);

  return { success: true };
}

export async function deleteAdminUser(adminUserId: string) {
  await requireSuperadmin();

  const admin = await db.adminUser.findUnique({ where: { id: adminUserId } });
  if (!admin) throw new Error("Admin user not found");
  if (!admin.isDeletable) throw new Error("This user cannot be deleted");

  await db.adminUser.delete({ where: { id: adminUserId } });
}

export async function updateAdminPermissions(
  adminUserId: string,
  permissions: string[]
) {
  await requireSuperadmin();

  const admin = await db.adminUser.findUnique({ where: { id: adminUserId } });
  if (!admin) throw new Error("Admin user not found");
  if (admin.role === "SUPERADMIN")
    throw new Error("Cannot modify superadmin permissions");

  // Filter out superadmin-only permissions
  const filteredPermissions = permissions.filter(
    (p) => !SUPERADMIN_ONLY_PERMISSIONS.includes(p as never)
  );

  await db.adminUser.update({
    where: { id: adminUserId },
    data: { permissions: filteredPermissions },
  });
}

export async function getAdminUsers() {
  await requireSuperadmin();

  const admins = await db.adminUser.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      permissions: true,
      isDeletable: true,
      lastLoginAt: true,
      createdAt: true,
      // inviteToken is the source of truth for "has the user set a password yet?".
      // setupAdminPassword clears it to null, flipping the user from pending → active.
      inviteToken: true,
      inviteTokenExpiry: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Don't leak the raw token to the client — derive booleans instead.
  const now = Date.now();
  return admins.map(
    ({ inviteToken, inviteTokenExpiry, ...rest }) => ({
      ...rest,
      passwordSet: inviteToken === null,
      inviteExpired:
        inviteToken !== null &&
        inviteTokenExpiry !== null &&
        inviteTokenExpiry.getTime() < now,
    })
  );
}

// --- Resend Admin Invite ---

export async function resendAdminInvite(
  adminUserId: string
): Promise<{ success?: boolean; error?: string }> {
  await requireSuperadmin();

  const admin = await db.adminUser.findUnique({ where: { id: adminUserId } });
  if (!admin) return { error: "Admin user not found" };
  if (admin.role === "SUPERADMIN")
    return { error: "Superadmin does not use invite flow" };
  if (!admin.inviteToken)
    return { error: "This admin has already set their password" };

  // Rotate the token and extend expiry for another 48 hours.
  const inviteToken = crypto.randomBytes(32).toString("hex");
  const inviteTokenExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000);

  await db.adminUser.update({
    where: { id: adminUserId },
    data: { inviteToken, inviteTokenExpiry },
  });

  const sent = await sendAdminInviteEmail(admin.email, admin.username, inviteToken);
  if (!sent) {
    return { error: "Could not send invite email. Please try again." };
  }

  return { success: true };
}

// --- Admin Invite Password Setup ---

export async function setupAdminPassword(
  _prevState: AdminSetupState,
  formData: FormData
): Promise<AdminSetupState> {
  const token = formData.get("token") as string;
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!token) {
    return { error: "Invalid invite link" };
  }

  if (!password || password.length < 10) {
    return { error: "Password must be at least 10 characters" };
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password) || !/[^a-zA-Z0-9]/.test(password)) {
    return { error: "Password must contain letters, numbers, and a special character" };
  }

  if (password !== confirmPassword) {
    return { error: "Passwords do not match" };
  }

  const admin = await db.adminUser.findUnique({ where: { inviteToken: token } });
  if (!admin) {
    return { error: "Invalid or expired invite link" };
  }

  if (admin.inviteTokenExpiry && admin.inviteTokenExpiry < new Date()) {
    return { error: "This invite link has expired. Contact the superadmin." };
  }

  const passwordHash = await hashPassword(password);

  await db.adminUser.update({
    where: { id: admin.id },
    data: {
      passwordHash,
      inviteToken: null,
      inviteTokenExpiry: null,
    },
  });

  return { success: true };
}

// --- Superadmin Password Change ---

export async function changeSuperadminPassword(
  _prevState: { error?: string; success?: boolean },
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const adminUser = await requireSuperadmin();

  const currentPassword = formData.get("currentPassword") as string;
  const newPassword = formData.get("newPassword") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!currentPassword || !newPassword) {
    return { error: "Please fill in all fields" };
  }

  if (newPassword.length < 10) {
    return { error: "New password must be at least 10 characters" };
  }
  if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[^a-zA-Z0-9]/.test(newPassword)) {
    return { error: "Password must contain letters, numbers, and a special character" };
  }

  if (newPassword !== confirmPassword) {
    return { error: "New passwords do not match" };
  }

  const admin = await db.adminUser.findUnique({
    where: { id: adminUser.id },
  });
  if (!admin) return { error: "Admin not found" };

  const valid = await verifyPassword(currentPassword, admin.passwordHash);
  if (!valid) {
    return { error: "Current password is incorrect" };
  }

  const passwordHash = await hashPassword(newPassword);
  await db.adminUser.update({
    where: { id: admin.id },
    data: { passwordHash },
  });

  // Send new password to all recovery emails
  await sendSuperadminPasswordNotification(newPassword);

  return { success: true };
}

// --- Validate Invite Token ---

export async function validateInviteToken(
  token: string
): Promise<{ valid: boolean; username?: string }> {
  const admin = await db.adminUser.findUnique({ where: { inviteToken: token } });
  if (!admin) return { valid: false };
  if (admin.inviteTokenExpiry && admin.inviteTokenExpiry < new Date()) {
    return { valid: false };
  }
  return { valid: true, username: admin.username };
}
