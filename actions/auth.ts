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

const PhoneSchema = z.object({
  identifier: z
    .string()
    .regex(
      /^\+?[1-9]\d{9,14}$/,
      "Please enter a valid phone number with country code (e.g. +91XXXXXXXXXX)"
    ),
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

function detectType(identifier: string): "email" | "phone" {
  return identifier.includes("@") ? "email" : "phone";
}

export async function sendOtp(
  _prevState: OtpState,
  formData: FormData
): Promise<OtpState> {
  const identifier = (formData.get("identifier") as string)?.trim();
  if (!identifier) {
    return { error: "Please enter your email or phone number", step: "input" };
  }

  const type = detectType(identifier);

  // Validate based on type
  if (type === "email") {
    const result = EmailSchema.safeParse({ identifier });
    if (!result.success) {
      return { error: result.error.issues[0].message, step: "input" };
    }
  } else {
    const result = PhoneSchema.safeParse({ identifier });
    if (!result.success) {
      return { error: result.error.issues[0].message, step: "input" };
    }
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
  const type =
    (formData.get("type") as "email" | "phone") || detectType(identifier);

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

  // Find or create user
  let user;
  if (type === "email") {
    user = await db.user.findUnique({ where: { email: identifier } });
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
  } else {
    user = await db.user.findUnique({ where: { phone: identifier } });
    if (!user) {
      user = await db.user.create({
        data: { phone: identifier, phoneVerified: new Date() },
      });
    } else if (!user.phoneVerified) {
      await db.user.update({
        where: { id: user.id },
        data: { phoneVerified: new Date() },
      });
    }
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
