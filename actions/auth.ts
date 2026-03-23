"use server";

import { z } from "zod";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  sendOtp as sendOtpToUser,
  verifyOtp as verifyOtpCode,
  resendOtp as resendOtpToUser,
} from "@/lib/otp";

const EmailSchema = z.object({
  identifier: z.string().email("Please enter a valid email address"),
});

const OtpSchema = z.object({
  code: z.string().length(6, "OTP must be 6 digits"),
});

export type OtpState = {
  error?: string;
  success?: boolean;
  step?: "input" | "verify";
  identifier?: string;
  type?: "email" | "phone";
  attemptsRemaining?: number;
};

export async function sendOtp(
  _prevState: OtpState,
  formData: FormData
): Promise<OtpState> {
  const identifier = (formData.get("identifier") as string)?.trim();
  if (!identifier) {
    return { error: "Please enter your email address", step: "input" };
  }

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
  const type = formData.get("type") as "email" | "phone";
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

  // Find or create user (email-only)
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
