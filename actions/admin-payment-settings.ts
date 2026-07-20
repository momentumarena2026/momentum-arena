"use server";

import { db } from "@/lib/db";
import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";
import { isDqrConfigured } from "@/lib/phonepe-dqr";
import type { PaymentGateway } from "@prisma/client";

// `requireAdminBase` resolves the caller from EITHER the web cookie
// session or the mobile Bearer JWT, so mobile admin routes delegate here
// with no auth-bypass argument. Never add one: every export in a
// "use server" module is a public endpoint whose arguments come from the
// client.
async function requireAdmin() {
  const user = await requireAdminBase("MANAGE_PAYMENT_SETTINGS");
  return user.id;
}

/**
 * Explicit public shape so the client never sees Prisma-internal fields.
 */
export interface PaymentSettings {
  activeGateway: PaymentGateway;
  onlineEnabled: boolean;
  upiQrEnabled: boolean;
  advanceEnabled: boolean;
  /** Admin toggle for the DQR (dynamic QR) UPI flow. */
  dqrEnabled: boolean;
  /** Nested under DQR: tap-to-pay UPI app picker (PhonePe Open Intent). */
  intentEnabled: boolean;
  /** Whether the PHONEPE_DQR_* env creds are present (read-only). */
  dqrConfigured: boolean;
}

async function readOrInit(): Promise<PaymentSettings> {
  const config = await db.paymentGatewayConfig.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton", activeGateway: "PHONEPE" },
  });
  return {
    activeGateway: config.activeGateway,
    onlineEnabled: config.onlineEnabled,
    upiQrEnabled: config.upiQrEnabled,
    advanceEnabled: config.advanceEnabled,
    // Admin view shows the raw toggle; checkout (getCheckoutPaymentConfig)
    // additionally requires creds to be present.
    dqrEnabled: config.dqrEnabled,
    intentEnabled: config.intentEnabled,
    dqrConfigured: isDqrConfigured(),
  };
}

export async function getPaymentGatewayConfig(): Promise<PaymentSettings> {
  return readOrInit();
}

export async function setActivePaymentGateway(gateway: PaymentGateway) {
  await requireAdmin();

  if (gateway !== "PHONEPE" && gateway !== "RAZORPAY") {
    return { success: false, error: "Invalid gateway" };
  }

  await db.paymentGatewayConfig.upsert({
    where: { id: "singleton" },
    update: { activeGateway: gateway },
    create: { id: "singleton", activeGateway: gateway },
  });

  return { success: true };
}

/**
 * Toggle the DQR (dynamic QR) UPI flow. Independent of the per-method
 * enablement flags — it only swaps the *implementation* behind the
 * "Pay by UPI" option (dynamic QR + auto-confirm vs legacy static QR).
 * Has no effect on checkout until the PHONEPE_DQR_* env creds are set
 * (see getCheckoutPaymentConfig).
 */
export async function setDqrEnabled(
  enabled: boolean,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  await db.paymentGatewayConfig.upsert({
    where: { id: "singleton" },
    update: { dqrEnabled: enabled },
    create: { id: "singleton", activeGateway: "PHONEPE", dqrEnabled: enabled },
  });
  return { success: true };
}

export type UpiQrMode = "STATIC" | "DQR" | "OFF";

/**
 * Atomically set which implementation backs the "Pay by UPI" option.
 * Static QR and DQR are mutually exclusive in the admin UI:
 *   STATIC → UPI shown, legacy static QR + manual UTR
 *   DQR    → UPI shown, dynamic QR / intent with auto-confirm
 *   OFF    → UPI hidden from checkout entirely
 * The at-least-one-method guard applies to OFF.
 */
export async function setUpiQrMode(
  mode: UpiQrMode,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  if (mode !== "STATIC" && mode !== "DQR" && mode !== "OFF") {
    return { success: false, error: "Invalid UPI mode" };
  }

  if (mode === "OFF") {
    const current = await readOrInit();
    if (!current.onlineEnabled && !current.advanceEnabled) {
      return {
        success: false,
        error:
          "At least one payment method must stay enabled. Enable another before turning UPI off.",
      };
    }
  }

  if (mode === "DQR" && !isDqrConfigured()) {
    return {
      success: false,
      error:
        "PhonePe DQR credentials are not configured — set the PHONEPE_DQR_* env vars first.",
    };
  }

  const data =
    mode === "OFF"
      ? { upiQrEnabled: false, dqrEnabled: false }
      : { upiQrEnabled: true, dqrEnabled: mode === "DQR" };

  await db.paymentGatewayConfig.upsert({
    where: { id: "singleton" },
    update: data,
    create: { id: "singleton", activeGateway: "PHONEPE", ...data },
  });

  return { success: true };
}

/**
 * Nested under DQR: tap-to-pay UPI app picker (PhonePe Open Intent) vs a
 * scan-only QR shown directly in the payment sheet. Admin-controlled in the
 * DB (replaces the PHONEPE_DQR_MODE env var) so flipping it needs no
 * redeploy. Only takes effect while DQR is the active UPI mode.
 */
export async function setIntentEnabled(
  enabled: boolean,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  await db.paymentGatewayConfig.upsert({
    where: { id: "singleton" },
    update: { intentEnabled: enabled },
    create: {
      id: "singleton",
      activeGateway: "PHONEPE",
      intentEnabled: enabled,
    },
  });
  return { success: true };
}

export type PaymentMethodFlag = "online" | "upi_qr" | "advance";

export async function setPaymentMethodEnabled(
  method: PaymentMethodFlag,
  enabled: boolean,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  // Safety: never let the admin disable all three, or checkout has no
  // way forward. Re-read current state and reject the toggle if it
  // would leave every method off.
  const current = await readOrInit();
  const next = {
    online: current.onlineEnabled,
    upi_qr: current.upiQrEnabled,
    advance: current.advanceEnabled,
  };
  next[method] = enabled;
  if (!next.online && !next.upi_qr && !next.advance) {
    return {
      success: false,
      error:
        "At least one payment method must stay enabled. Enable another before disabling this one.",
    };
  }

  const fieldMap: Record<
    PaymentMethodFlag,
    "onlineEnabled" | "upiQrEnabled" | "advanceEnabled"
  > = {
    online: "onlineEnabled",
    upi_qr: "upiQrEnabled",
    advance: "advanceEnabled",
  };

  await db.paymentGatewayConfig.upsert({
    where: { id: "singleton" },
    update: { [fieldMap[method]]: enabled },
    create: {
      id: "singleton",
      activeGateway: "PHONEPE",
      [fieldMap[method]]: enabled,
    },
  });

  return { success: true };
}

// Public: called from checkout to determine which gateway to show
export async function getActiveGateway(): Promise<"PHONEPE" | "RAZORPAY"> {
  const config = await db.paymentGatewayConfig.findUnique({
    where: { id: "singleton" },
  });
  return (config?.activeGateway as "PHONEPE" | "RAZORPAY") || "PHONEPE";
}

// Public: single fetch with everything the checkout needs — active
// gateway plus per-method enablement. Falls back to all-enabled on a
// fresh DB where the singleton doesn't exist yet.
export async function getCheckoutPaymentConfig(): Promise<PaymentSettings> {
  const config = await db.paymentGatewayConfig.findUnique({
    where: { id: "singleton" },
  });
  const dqrConfigured = isDqrConfigured();
  if (!config) {
    return {
      activeGateway: "PHONEPE",
      onlineEnabled: true,
      upiQrEnabled: true,
      advanceEnabled: true,
      // Fresh DB: DQR off until an admin opts in (and creds exist).
      dqrEnabled: false,
      intentEnabled: false,
      dqrConfigured,
    };
  }
  return {
    activeGateway: config.activeGateway,
    onlineEnabled: config.onlineEnabled,
    upiQrEnabled: config.upiQrEnabled,
    advanceEnabled: config.advanceEnabled,
    // Effective DQR requires BOTH the admin toggle and live creds.
    dqrEnabled: config.dqrEnabled && dqrConfigured,
    intentEnabled: config.intentEnabled,
    dqrConfigured,
  };
}

/**
 * Server-side guard: is a given checkout payment method currently enabled by
 * the admin payment config? Mirrors the client-side gating so a method an
 * admin has disabled can't be ordered by hitting the API directly. CASH
 * (pay at venue / counter) has no toggle and is always allowed.
 */
export async function isCheckoutMethodEnabled(method: string): Promise<boolean> {
  const cfg = await getCheckoutPaymentConfig();
  switch (method) {
    case "RAZORPAY":
    case "PHONEPE":
      return cfg.onlineEnabled;
    case "UPI_QR":
      return cfg.upiQrEnabled;
    case "UPI_NOW":
    case "DQR":
      return cfg.dqrEnabled;
    case "CASH":
      return true;
    default:
      return false;
  }
}
