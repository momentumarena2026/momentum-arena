"use server";

import { db } from "@/lib/db";
import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";
import type { PaymentGateway } from "@prisma/client";

async function requireAdmin() {
  const user = await requireAdminBase("MANAGE_PRICING");
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

export type PaymentMethodFlag = "online" | "upi_qr" | "advance";

export async function setPaymentMethodEnabled(
  method: PaymentMethodFlag,
  enabled: boolean
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
  if (!config) {
    return {
      activeGateway: "PHONEPE",
      onlineEnabled: true,
      upiQrEnabled: true,
      advanceEnabled: true,
    };
  }
  return {
    activeGateway: config.activeGateway,
    onlineEnabled: config.onlineEnabled,
    upiQrEnabled: config.upiQrEnabled,
    advanceEnabled: config.advanceEnabled,
  };
}
