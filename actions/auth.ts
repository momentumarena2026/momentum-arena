"use server";

import { z } from "zod";
import { AuthError } from "next-auth";
import { signIn, auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import {
  sendOtp as sendOtpToUser,
  verifyOtp as verifyOtpCode,
  resendOtp as resendOtpToUser,
} from "@/lib/otp";

const EmailSchema = z.object({
  identifier: z.string().email("Please enter a valid email address"),
});

// Phone OTP disabled for now
// const PhoneSchema = z.object({
//   identifier: z
//     .string()
//     .regex(
//       /^\+?[1-9]\d{9,14}$/,
//       "Please enter a valid phone number with country code (e.g. +91XXXXXXXXXX)"
//     ),
// });

const OtpSchema = z.object({
  code: z.string().length(6, "OTP must be 6 digits"),
});

const PasswordSchema = z.object({
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .regex(/[a-zA-Z]/, "Password must contain at least one letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(
      /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/,
      "Password must contain at least one special character"
    ),
});

export type OtpState = {
  error?: string;
  success?: boolean;
  step?: "input" | "verify";
  identifier?: string;
  type?: "email" | "phone";
  attemptsRemaining?: number;
  needsPasswordSetup?: boolean;
};

export type PasswordLoginState = {
  error?: string;
  errorCode?: "PASSWORD_NOT_SET" | "INVALID_CREDENTIALS" | "NO_ACCOUNT";
  success?: boolean;
};

export type SetPasswordState = {
  error?: string;
  success?: boolean;
};

export type ForgotPasswordState = {
  error?: string;
  success?: boolean;
  step?: "email" | "otp" | "reset" | "done";
  identifier?: string;
};

export async function sendOtp(
  _prevState: OtpState,
  formData: FormData
): Promise<OtpState> {
  const identifier = (formData.get("identifier") as string)?.trim();
  if (!identifier) {
    return { error: "Please enter your email address", step: "input" };
  }

  // Only email OTP supported (phone disabled)
  const type = "email" as const;

  const result = EmailSchema.safeParse({ identifier });
  if (!result.success) {
    return { error: result.error.issues[0].message, step: "input" };
  }

  const otpResult = await sendOtpToUser(identifier, type);
  if (!otpResult.success) {
    return { error: otpResult.error || "Failed to send OTP.", step: "input" };
  }

  return {
    success: true,
    step: "verify",
    identifier,
    type,
  };
}

export async function resendOtp(
  _prevState: OtpState,
  formData: FormData
): Promise<OtpState> {
  const identifier = formData.get("identifier") as string;
  const type = "email" as const;

  const otpResult = await resendOtpToUser(identifier, type);
  if (!otpResult.success) {
    return {
      error: otpResult.error || "Failed to resend OTP.",
      step: "verify",
      identifier,
      type,
    };
  }

  return { success: true, step: "verify", identifier, type };
}

export async function verifyOtpAndLogin(
  _prevState: OtpState,
  formData: FormData
): Promise<OtpState> {
  const identifier = formData.get("identifier") as string;
  const type = "email" as const;
  const code = formData.get("code") as string;

  const validated = OtpSchema.safeParse({ code });
  if (!validated.success) {
    return {
      error: validated.error.issues[0].message,
      step: "verify",
      identifier,
      type,
    };
  }

  const verifyResult = await verifyOtpCode(identifier, code, type);
  if (!verifyResult.success) {
    return {
      error: verifyResult.error || "Invalid OTP.",
      step: "verify",
      identifier,
      type,
      attemptsRemaining: verifyResult.attemptsRemaining,
    };
  }

  // Find or create user
  let user = await db.user.findUnique({ where: { email: identifier } });
  if (!user) {
    user = await db.user.create({
      data: { email: identifier, emailVerified: new Date() },
    });
  } else if (!user.emailVerified) {
    await db.user.update({
      where: { id: user.id },
      data: { emailVerified: new Date() },
    });
  }

  try {
    await signIn("otp", {
      identifier,
      type,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        error: "Authentication failed. Please try again.",
        step: "verify",
        identifier,
        type,
      };
    }
    throw error; // re-throw redirect errors
  }

  return { success: true, step: "verify", identifier, type };
}

// --- Password Login ---

export async function loginWithPassword(
  _prevState: PasswordLoginState,
  formData: FormData
): Promise<PasswordLoginState> {
  const email = (formData.get("email") as string)?.trim();
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Please enter email and password" };
  }

  const emailResult = EmailSchema.safeParse({ identifier: email });
  if (!emailResult.success) {
    return { error: "Please enter a valid email address" };
  }

  // Rate limit: max 5 password attempts per email per 15 minutes
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);
  const rateEntry = await db.rateLimit.findUnique({
    where: { identifier_action: { identifier: `pwd:${email}`, action: "login" } },
  });
  if (rateEntry && rateEntry.windowStart > fifteenMinAgo && rateEntry.count >= 5) {
    return { error: "Too many login attempts. Please try again in 15 minutes." };
  }
  await db.rateLimit.upsert({
    where: { identifier_action: { identifier: `pwd:${email}`, action: "login" } },
    create: { identifier: `pwd:${email}`, action: "login", count: 1, windowStart: new Date() },
    update: rateEntry && rateEntry.windowStart > fifteenMinAgo
      ? { count: { increment: 1 } }
      : { count: 1, windowStart: new Date() },
  });

  // Check if user exists
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, emailVerified: true },
  });

  if (!user) {
    return {
      error: "No account found with this email. Please sign up with OTP first.",
      errorCode: "NO_ACCOUNT",
    };
  }

  if (!user.passwordHash) {
    return {
      error:
        "You haven't set a password yet. Please login with OTP first, then set a password.",
      errorCode: "PASSWORD_NOT_SET",
    };
  }

  try {
    await signIn("customer-password", {
      email,
      password,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        error: "Invalid email or password.",
        errorCode: "INVALID_CREDENTIALS",
      };
    }
    throw error; // re-throw redirect errors
  }

  return { success: true };
}

// --- Set Password (after first login) ---

export async function setPassword(
  _prevState: SetPasswordState,
  formData: FormData
): Promise<SetPasswordState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You must be logged in to set a password" };
  }

  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (password !== confirmPassword) {
    return { error: "Passwords do not match" };
  }

  const validated = PasswordSchema.safeParse({ password });
  if (!validated.success) {
    return { error: validated.error.issues[0].message };
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { emailVerified: true, accounts: { where: { provider: "google" }, select: { id: true } } },
  });

  // Email is verified if emailVerified is set OR user has a Google account linked
  const isEmailVerified = !!user?.emailVerified || (user?.accounts?.length ?? 0) > 0;

  if (!isEmailVerified) {
    return { error: "Please verify your email first by logging in with OTP." };
  }

  // If email wasn't marked as verified yet (Google user), mark it now
  if (!user?.emailVerified) {
    await db.user.update({
      where: { id: session.user.id },
      data: { emailVerified: new Date() },
    });
  }

  const passwordHash = await hashPassword(password);

  await db.user.update({
    where: { id: session.user.id },
    data: { passwordHash, passwordSetAt: new Date() },
  });

  return { success: true };
}

// --- Forgot Password ---

export async function forgotPasswordSendOtp(
  _prevState: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const identifier = (formData.get("email") as string)?.trim();
  if (!identifier) {
    return { error: "Please enter your email address", step: "email" };
  }

  const emailResult = EmailSchema.safeParse({ identifier });
  if (!emailResult.success) {
    return { error: "Please enter a valid email address", step: "email" };
  }

  // Check user exists
  const user = await db.user.findUnique({ where: { email: identifier } });
  if (!user) {
    return { error: "No account found with this email.", step: "email" };
  }

  const otpResult = await sendOtpToUser(identifier, "email");
  if (!otpResult.success) {
    return {
      error: otpResult.error || "Failed to send OTP.",
      step: "email",
    };
  }

  return { success: true, step: "otp", identifier };
}

export async function forgotPasswordVerifyAndReset(
  _prevState: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const identifier = formData.get("identifier") as string;
  const code = formData.get("code") as string;
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  // Validate OTP
  const otpValidated = OtpSchema.safeParse({ code });
  if (!otpValidated.success) {
    return {
      error: otpValidated.error.issues[0].message,
      step: "reset",
      identifier,
    };
  }

  // Validate password
  if (password !== confirmPassword) {
    return { error: "Passwords do not match", step: "reset", identifier };
  }

  const pwValidated = PasswordSchema.safeParse({ password });
  if (!pwValidated.success) {
    return {
      error: pwValidated.error.issues[0].message,
      step: "reset",
      identifier,
    };
  }

  // Verify OTP
  const verifyResult = await verifyOtpCode(identifier, code, "email");
  if (!verifyResult.success) {
    return {
      error: verifyResult.error || "Invalid OTP.",
      step: "reset",
      identifier,
    };
  }

  // Set new password
  const passwordHash = await hashPassword(password);
  await db.user.update({
    where: { email: identifier },
    data: {
      passwordHash,
      passwordSetAt: new Date(),
      emailVerified: new Date(), // Ensure email is verified
    },
  });

  return { success: true, step: "done", identifier };
}
