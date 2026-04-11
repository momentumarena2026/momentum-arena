import { db } from "@/lib/db";

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const MSG91_TEMPLATE_ID = "69da332ff712e50e0000e0d2";
const OTP_EXPIRY_MINUTES = 5;
const MAX_OTP_SENDS_PER_WINDOW = 5;
const RATE_LIMIT_WINDOW_MINUTES = 15;
const LOCKOUT_MINUTES = 30;

// Dev OTP bypass requires EXPLICIT opt-in via ENABLE_DEV_OTP=true
const isDevOtpEnabled = process.env.ENABLE_DEV_OTP === "true" && process.env.NODE_ENV === "development";
const DEV_OTP = "123456";

// --- Rate Limiting ---

async function checkRateLimit(identifier: string): Promise<{ allowed: boolean; retryAfter?: number }> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000);

  const record = await db.rateLimit.findUnique({
    where: { identifier_action: { identifier, action: "otp_send" } },
  });

  if (!record || record.windowStart < windowStart) {
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

// --- Send OTP via MSG91 ---

export type OtpResult = {
  success: boolean;
  error?: string;
  retryAfter?: number;
};

export async function sendPhoneOtp(phone: string): Promise<OtpResult> {
  // Normalize phone: ensure it has 91 prefix, no +
  const normalizedPhone = normalizePhone(phone);

  // Check lockout
  const lockout = await checkLockout(normalizedPhone);
  if (lockout.locked) {
    return {
      success: false,
      error: `Too many failed attempts. Try again in ${Math.ceil(lockout.retryAfter! / 60)} minutes.`,
      retryAfter: lockout.retryAfter,
    };
  }

  // Check rate limit
  const rateLimit = await checkRateLimit(normalizedPhone);
  if (!rateLimit.allowed) {
    return {
      success: false,
      error: `Too many OTP requests. Try again in ${Math.ceil(rateLimit.retryAfter! / 60)} minutes.`,
      retryAfter: rateLimit.retryAfter,
    };
  }

  if (isDevOtpEnabled && !MSG91_AUTH_KEY) {
    console.log(`\n🔑 [DEV] OTP for ${normalizedPhone}: ${DEV_OTP}\n`);
    return { success: true };
  }

  try {
    const response = await fetch("https://control.msg91.com/api/v5/otp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: MSG91_AUTH_KEY!,
      },
      body: JSON.stringify({
        template_id: MSG91_TEMPLATE_ID,
        mobile: normalizedPhone,
        otp_length: 6,
        otp_expiry: OTP_EXPIRY_MINUTES,
      }),
    });

    const data = await response.json();
    console.log("MSG91 send OTP response:", JSON.stringify(data));

    if (data.type === "success" || data.type === "otp_sent") {
      return { success: true };
    }

    return { success: false, error: "Failed to send OTP. Please try again." };
  } catch (error) {
    console.error("MSG91 send OTP error:", error);
    return { success: false, error: "Failed to send OTP. Please try again." };
  }
}

// --- Verify OTP via MSG91 ---

export type VerifyResult = {
  success: boolean;
  error?: string;
  attemptsRemaining?: number;
};

export async function verifyPhoneOtp(phone: string, otp: string): Promise<VerifyResult> {
  const normalizedPhone = normalizePhone(phone);

  if (isDevOtpEnabled && !MSG91_AUTH_KEY) {
    return otp === DEV_OTP
      ? { success: true }
      : { success: false, error: "Invalid OTP.", attemptsRemaining: 3 };
  }

  // Check lockout
  const lockout = await checkLockout(normalizedPhone);
  if (lockout.locked) {
    return {
      success: false,
      error: `Account locked. Try again in ${Math.ceil(lockout.retryAfter! / 60)} minutes.`,
    };
  }

  try {
    // MSG91 verify OTP API
    const response = await fetch(
      `https://control.msg91.com/api/v5/otp/verify?mobile=${normalizedPhone}&otp=${otp}`,
      {
        method: "GET",
        headers: {
          authkey: MSG91_AUTH_KEY!,
        },
      }
    );

    const data = await response.json();
    console.log("MSG91 verify OTP response:", JSON.stringify(data));

    if (data.type === "success") {
      await clearLockout(normalizedPhone);
      return { success: true };
    }

    // Track failed attempts via our own rate limiter
    const attemptKey = `verify:${normalizedPhone}`;
    const now = new Date();
    const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000);

    const record = await db.rateLimit.findUnique({
      where: { identifier_action: { identifier: attemptKey, action: "otp_verify" } },
    });

    const currentCount = (record && record.windowStart > windowStart) ? record.count : 0;
    const newCount = currentCount + 1;

    await db.rateLimit.upsert({
      where: { identifier_action: { identifier: attemptKey, action: "otp_verify" } },
      create: { identifier: attemptKey, action: "otp_verify", count: 1, windowStart: now },
      update: (record && record.windowStart > windowStart)
        ? { count: { increment: 1 } }
        : { count: 1, windowStart: now },
    });

    if (newCount >= 5) {
      await setLockout(normalizedPhone);
      return {
        success: false,
        error: `Too many wrong attempts. Account locked for ${LOCKOUT_MINUTES} minutes.`,
        attemptsRemaining: 0,
      };
    }

    // Check if OTP expired based on MSG91 error message
    const errorMsg = data.message?.toLowerCase() || "";
    if (errorMsg.includes("expired") || errorMsg.includes("already verified")) {
      return { success: false, error: "OTP expired. Please request a new one." };
    }

    return {
      success: false,
      error: `Invalid OTP. ${5 - newCount} attempt(s) remaining.`,
      attemptsRemaining: 5 - newCount,
    };
  } catch (error) {
    console.error("MSG91 verify OTP error:", error);
    return { success: false, error: "Verification failed. Please try again." };
  }
}

// --- Resend OTP via MSG91 ---

export async function resendPhoneOtp(phone: string): Promise<OtpResult> {
  const normalizedPhone = normalizePhone(phone);

  if (isDevOtpEnabled && !MSG91_AUTH_KEY) {
    console.log(`\n🔑 [DEV] Resend OTP for ${normalizedPhone}: ${DEV_OTP}\n`);
    return { success: true };
  }

  // Check rate limit
  const rateLimit = await checkRateLimit(normalizedPhone);
  if (!rateLimit.allowed) {
    return {
      success: false,
      error: `Too many OTP requests. Try again in ${Math.ceil(rateLimit.retryAfter! / 60)} minutes.`,
      retryAfter: rateLimit.retryAfter,
    };
  }

  try {
    // MSG91 retry OTP API
    const response = await fetch(
      `https://control.msg91.com/api/v5/otp/retry?mobile=${normalizedPhone}&retrytype=text`,
      {
        method: "POST",
        headers: {
          authkey: MSG91_AUTH_KEY!,
        },
      }
    );

    const data = await response.json();
    console.log("MSG91 resend OTP response:", JSON.stringify(data));

    if (data.type === "success") {
      return { success: true };
    }

    // If retry fails, send a fresh OTP
    return sendPhoneOtp(phone);
  } catch (error) {
    console.error("MSG91 resend OTP error:", error);
    return { success: false, error: "Failed to resend OTP. Please try again." };
  }
}

// --- Helpers ---

function normalizePhone(phone: string): string {
  // Remove all non-digits
  let cleaned = phone.replace(/\D/g, "");

  // If it starts with 0, remove it
  if (cleaned.startsWith("0")) {
    cleaned = cleaned.slice(1);
  }

  // If it's 10 digits (Indian number without country code), prepend 91
  if (cleaned.length === 10) {
    cleaned = "91" + cleaned;
  }

  return cleaned;
}

// Export for use in actions
export { normalizePhone };
