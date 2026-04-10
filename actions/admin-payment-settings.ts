"use server";

import { db } from "@/lib/db";
import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";
import type { PaymentGateway } from "@prisma/client";

async function requireAdmin() {
  const user = await requireAdminBase("MANAGE_PRICING");
  return user.id;
}

export async function getPaymentGatewayConfig() {
  const config = await db.paymentGatewayConfig.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton", activeGateway: "PHONEPE" },
  });
  return config;
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

// Public: called from checkout to determine which gateway to show
export async function getActiveGateway(): Promise<"PHONEPE" | "RAZORPAY"> {
  const config = await db.paymentGatewayConfig.findUnique({
    where: { id: "singleton" },
  });
  return (config?.activeGateway as "PHONEPE" | "RAZORPAY") || "PHONEPE";
}
