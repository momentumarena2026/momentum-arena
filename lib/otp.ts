import { db } from "@/lib/db";
import crypto from "crypto";

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const MSG91_EMAIL_API = "https://control.msg91.com/api/v5/email/send";
const OTP_EXPIRY_MINUTES = 5;
const MAX_OTP_ATTEMPTS = 3;
const MAX_OTP_SENDS_PER_WINDOW = 5;
const RATE_LIMIT_WINDOW_MINUTES = 15;
const LOCKOUT_MINUTES = 30;

const isDev = process.env.NODE_ENV === "development";
const DEV_OTP = "123456";

function generateOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}

// --- Rate Limiting ---

async function checkRateLimit(identifier: string): Promise<{ allowed: boolean; retryAfter?: number }> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000);

  const record = await db.rateLimit.findUnique({
    where: { identifier_action: { identifier, action: "otp_send" } },
  });

  if (!record || record.windowStart < windowStart) {
    // No record or window expired — reset
    await db.rateLimit.upsert({
      where: { identifier_action: { identifier, action: "otp_send" } },
      create: { identifier, action: "otp_send", count: 1, windowStart: now },
      update: { count: 1, windowStart: now },
    });
    return { allowed: true };
  }

  if (record.count >= MAX_OTP_SENDS_PER_WINDOW) {
    const retryAfter = Math.ceil(
      (record.windowStart.getTime() + RATE_LIMIT_WINDOW_MINUTES * 60 * 1000 - now.getTime()) / 1000
    );
    return { allowed: false, retryAfter };
  }

  // Increment count
  await db.rateLimit.update({
    where: { identifier_action: { identifier, action: "otp_send" } },
    data: { count: { increment: 1 } },
  });

  return { allowed: true };
}

async function checkLockout(identifier: string): Promise<{ locked: boolean; retryAfter?: number }> {
  const now = new Date();
  const lockoutEnd = new Date(now.getTime() - LOCKOUT_MINUTES * 60 * 1000);

  const record = await db.rateLimit.findUnique({
    where: { identifier_action: { identifier, action: "otp_lockout" } },
  });

  if (!record || record.windowStart < lockoutEnd) {
    return { locked: false };
  }

  const retryAfter = Math.ceil(
    (record.windowStart.getTime() + LOCKOUT_MINUTES * 60 * 1000 - now.getTime()) / 1000
  );
  return { locked: true, retryAfter };
}

async function setLockout(identifier: string): Promise<void> {
  await db.rateLimit.upsert({
    where: { identifier_action: { identifier, action: "otp_lockout" } },
    create: { identifier, action: "otp_lockout", count: 1, windowStart: new Date() },
    update: { count: { increment: 1 }, windowStart: new Date() },
  });
}

async function clearLockout(identifier: string): Promise<void> {
  await db.rateLimit.deleteMany({
    where: { identifier, action: "otp_lockout" },
  });
}

// --- Send OTP ---

export type OtpResult = {
  success: boolean;
  error?: string;
  retryAfter?: number;
};

export async function sendOtp(
  identifier: string,
  type: "email" | "phone"
): Promise<OtpResult> {
  // Check lockout
  const lockout = await checkLockout(identifier);
  if (lockout.locked) {
    return {
      success: false,
      error: `Too many failed attempts. Try again in ${Math.ceil(lockout.retryAfter! / 60)} minutes.`,
      retryAfter: lockout.retryAfter,
    };
  }

  // Check rate limit
  const rateLimit = await checkRateLimit(identifier);
  if (!rateLimit.allowed) {
    return {
      success: false,
      error: `Too many OTP requests. Try again in ${Math.ceil(rateLimit.retryAfter! / 60)} minutes.`,
      retryAfter: rateLimit.retryAfter,
    };
  }

  if (isDev && !MSG91_AUTH_KEY) {
    console.log(`\n🔑 [DEV] OTP for ${identifier}: ${DEV_OTP}\n`);
    await storeOtp(identifier, DEV_OTP);
    return { success: true };
  }

  const otp = generateOtp();
  await storeOtp(identifier, otp);

  if (type === "email") {
    const sent = await sendEmailOtp(identifier, otp);
    if (!sent) {
      return { success: false, error: "Failed to send OTP. Please try again." };
    }
    return { success: true };
  } else {
    const sent = await sendSmsOtp(identifier, otp);
    if (!sent) {
      return { success: false, error: "Failed to send SMS OTP. Please try again." };
    }
    return { success: true };
  }
}

// --- Verify OTP ---

export type VerifyResult = {
  success: boolean;
  error?: string;
  attemptsRemaining?: number;
};

export async function verifyOtp(
  identifier: string,
  code: string,
  _type: "email" | "phone"
): Promise<VerifyResult> {
  if (isDev && !MSG91_AUTH_KEY) {
    return code === DEV_OTP
      ? { success: true }
      : { success: false, error: "Invalid OTP.", attemptsRemaining: MAX_OTP_ATTEMPTS };
  }

  // Check lockout
  const lockout = await checkLockout(identifier);
  if (lockout.locked) {
    return {
      success: false,
      error: `Account locked. Try again in ${Math.ceil(lockout.retryAfter! / 60)} minutes.`,
    };
  }

  try {
    const record = await db.verificationToken.findFirst({
      where: {
        identifier,
        expires: { gt: new Date() },
      },
    });

    if (!record) {
      return { success: false, error: "OTP expired. Please request a new one." };
    }

    if (record.token !== code) {
      // Wrong OTP — increment attempts
      const newAttempts = record.attempts + 1;

      if (newAttempts >= MAX_OTP_ATTEMPTS) {
        // Max attempts reached — delete token and set lockout
        await db.verificationToken.deleteMany({ where: { identifier } });
        await setLockout(identifier);
        return {
          success: false,
          error: `Too many wrong attempts. Account locked for ${LOCKOUT_MINUTES} minutes.`,
          attemptsRemaining: 0,
        };
      }

      await db.verificationToken.update({
        where: { identifier_token: { identifier, token: record.token } },
        data: { attempts: newAttempts },
      });

      return {
        success: false,
        error: `Invalid OTP. ${MAX_OTP_ATTEMPTS - newAttempts} attempt(s) remaining.`,
        attemptsRemaining: MAX_OTP_ATTEMPTS - newAttempts,
      };
    }

    // Correct OTP — delete token and clear lockout
    await db.verificationToken.delete({
      where: { identifier_token: { identifier, token: code } },
    });
    await clearLockout(identifier);

    return { success: true };
  } catch (error) {
    console.error("OTP verification error:", error);
    return { success: false, error: "Verification failed. Please try again." };
  }
}

// --- Resend OTP ---

export async function resendOtp(
  identifier: string,
  type: "email" | "phone"
): Promise<OtpResult> {
  return sendOtp(identifier, type);
}

// --- Helpers ---

async function sendSmsOtp(phone: string, otp: string): Promise<boolean> {
  try {
    // MSG91 OTP SMS API
    const response = await fetch("https://control.msg91.com/api/v5/otp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: MSG91_AUTH_KEY!,
      },
      body: JSON.stringify({
        mobile: phone.replace("+", ""),
        otp,
        template_id: process.env.MSG91_SMS_TEMPLATE_ID || process.env.MSG91_TEMPLATE_ID || "",
        otp_length: 6,
        otp_expiry: OTP_EXPIRY_MINUTES,
      }),
    });

    const data = await response.json();
    console.log("MSG91 SMS response:", JSON.stringify(data));

    return data.type === "success" || data.type === "otp_sent";
  } catch (error) {
    console.error("MSG91 SMS send error:", error);
    return false;
  }
}

async function sendEmailOtp(email: string, otp: string): Promise<boolean> {
  try {
    const response = await fetch(MSG91_EMAIL_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: MSG91_AUTH_KEY!,
      },
      body: JSON.stringify({
        recipients: [
          {
            to: [{ email, name: "" }],
            variables: {
              company_name: "Momentum Arena",
              otp,
            },
          },
        ],
        from: { email: "noreply@momentumarena.com" },
        domain: "momentumarena.com",
        template_id: "global_otp",
      }),
    });

    const data = await response.json();
    return data.status === "success";
  } catch (error) {
    console.error("MSG91 email send error:", error);
    return false;
  }
}

async function storeOtp(identifier: string, otp: string): Promise<void> {
  const expires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  // Delete any existing tokens for this identifier
  await db.verificationToken.deleteMany({
    where: { identifier },
  });

  // Create new token
  await db.verificationToken.create({
    data: {
      identifier,
      token: otp,
      expires,
      attempts: 0,
    },
  });
}
