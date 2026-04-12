"use server";

import { z } from "zod";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  sendPhoneOtp,
  verifyPhoneOtp,
  resendPhoneOtp,
  normalizePhone,
} from "@/lib/otp";

const PhoneSchema = z.object({
  phone: z
    .string()
    .min(10, "Please enter a valid phone number")
    .regex(/^[0-9+\s-]+$/, "Please enter a valid phone number"),
});

const OtpSchema = z.object({
  code: z.string().length(6, "OTP must be 6 digits"),
});

export type OtpState = {
  error?: string;
  success?: boolean;
  step?: "input" | "verify" | "name";
  phone?: string;
  attemptsRemaining?: number;
};

export async function sendOtp(
  _prevState: OtpState,
  formData: FormData
): Promise<OtpState> {
  const phone = (formData.get("phone") as string)?.trim();
  if (!phone) {
    return { error: "Please enter your phone number", step: "input" };
  }

  const result = PhoneSchema.safeParse({ phone });
  if (!result.success) {
    return { error: result.error.issues[0].message, step: "input" };
  }

  const otpResult = await sendPhoneOtp(phone);
  if (!otpResult.success) {
    return { error: otpResult.error || "Failed to send OTP.", step: "input" };
  }

  return {
    success: true,
    step: "verify",
    phone: normalizePhone(phone),
  };
}

export async function resendOtp(
  _prevState: OtpState,
  formData: FormData
): Promise<OtpState> {
  const phone = formData.get("phone") as string;

  const otpResult = await resendPhoneOtp(phone);
  if (!otpResult.success) {
    return {
      error: otpResult.error || "Failed to resend OTP.",
      step: "verify",
      phone,
    };
  }

  return { success: true, step: "verify", phone };
}

export async function verifyOtpAndLogin(
  _prevState: OtpState,
  formData: FormData
): Promise<OtpState> {
  const phone = formData.get("phone") as string;
  const code = formData.get("code") as string;

  const validated = OtpSchema.safeParse({ code });
  if (!validated.success) {
    return {
      error: validated.error.issues[0].message,
      step: "verify",
      phone,
    };
  }

  const verifyResult = await verifyPhoneOtp(phone, code);
  if (!verifyResult.success) {
    return {
      error: verifyResult.error || "Invalid OTP.",
      step: "verify",
      phone,
      attemptsRemaining: verifyResult.attemptsRemaining,
    };
  }

  const normalizedPhone = normalizePhone(phone);

  // Find or create user by phone
  let user = await db.user.findUnique({ where: { phone: normalizedPhone } });
  if (!user) {
    user = await db.user.create({
      data: {
        phone: normalizedPhone,
        phoneVerified: new Date(),
      },
    });
  } else if (!user.phoneVerified) {
    await db.user.update({
      where: { id: user.id },
      data: { phoneVerified: new Date() },
    });
  }

  // If user has no name, ask for it before signing in
  if (!user.name) {
    return {
      success: true,
      step: "name",
      phone: normalizedPhone,
    };
  }

  // Determine redirect destination
  const callbackUrl = formData.get("callbackUrl") as string;
  const redirectTo = callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : "/dashboard";

  // User already has a name — sign in directly
  try {
    await signIn("otp", {
      phone: normalizedPhone,
      redirectTo,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        error: "Authentication failed. Please try again.",
        step: "verify",
        phone,
      };
    }
    throw error;
  }

  return { success: true, step: "verify", phone };
}

export async function saveNameAndLogin(
  _prevState: OtpState,
  formData: FormData
): Promise<OtpState> {
  const phone = formData.get("phone") as string;
  const name = (formData.get("name") as string)?.trim();

  if (!name || name.length < 2) {
    return {
      error: "Please enter your name (at least 2 characters)",
      step: "name",
      phone,
    };
  }

  if (name.length > 50) {
    return {
      error: "Name must be 50 characters or less",
      step: "name",
      phone,
    };
  }

  const normalizedPhone = normalizePhone(phone);

  // Update the user's name
  const user = await db.user.findUnique({ where: { phone: normalizedPhone } });
  if (!user) {
    return {
      error: "User not found. Please try again.",
      step: "input",
    };
  }

  await db.user.update({
    where: { id: user.id },
    data: { name },
  });

  // Determine redirect destination
  const callbackUrl = formData.get("callbackUrl") as string;
  const redirectTo = callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : "/dashboard";

  // Now sign in
  try {
    await signIn("otp", {
      phone: normalizedPhone,
      redirectTo,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        error: "Authentication failed. Please try again.",
        step: "name",
        phone,
      };
    }
    throw error;
  }

  return { success: true, phone };
}
