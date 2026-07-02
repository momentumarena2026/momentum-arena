"use server";

import { db } from "@/lib/db";
import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";
import { isDqrConfigured } from "@/lib/phonepe-dqr";
import type { PaymentGateway } from "@prisma/client";

async function requireAdmin(skipAuth = false) {
  // Mobile admin routes authenticate the bearer token themselves (via
  // getMobileAdmin) before delegating here, so they pass skipAuth=true to
  // bypass the cookie-session check that wouldn't apply to a JWT request.
  if (skipAuth) return null;
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
    dqrConfigured: isDqrConfigured(),
  };
}

export async function getPaymentGatewayConfig(): Promise<PaymentSettings> {
  return readOrInit();
}

export async function setActivePaymentGateway(
  gateway: PaymentGateway,
  skipAuth = false,
) {
  await requireAdmin(skipAuth);

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
  skipAuth = false,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin(skipAuth);
  await db.paymentGatewayConfig.upsert({
    where: { id: "singleton" },
    update: { dqrEnabled: enabled },
    create: { id: "singleton", activeGateway: "PHONEPE", dqrEnabled: enabled },
  });
  return { success: true };
}

export type PaymentMethodFlag = "online" | "upi_qr" | "advance";

export async function setPaymentMethodEnabled(
  method: PaymentMethodFlag,
  enabled: boolean,
  skipAuth = false,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin(skipAuth);

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
