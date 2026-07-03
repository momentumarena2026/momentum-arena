import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import {
  getPaymentGatewayConfig,
  setActivePaymentGateway,
  setDqrEnabled,
  setIntentEnabled,
  setPaymentMethodEnabled,
  setUpiQrMode,
  type PaymentMethodFlag,
  type UpiQrMode,
} from "@/actions/admin-payment-settings";
import type { PaymentGateway } from "@prisma/client";

/**
 * Mobile admin payment-gateway settings. GET returns the full PaymentSettings
 * shape; POST applies one change at a time (active gateway, DQR toggle, or a
 * per-method enablement flag) and returns the refreshed config. The underlying
 * actions are reused with skipAuth=true since the bearer token is validated
 * here. Permission: MANAGE_PAYMENT_SETTINGS (mirrors the web /admin/payment-settings
 * sidebar gate; superadmin always passes).
 */
async function guard(
  request: NextRequest,
  permission: "MANAGE_PAYMENT_SETTINGS",
) {
  const admin = await getMobileAdmin(request);
  if (!admin)
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], permission)
  ) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

export async function GET(request: NextRequest) {
  const g = await guard(request, "MANAGE_PAYMENT_SETTINGS");
  if ("error" in g) return g.error;
  const config = await getPaymentGatewayConfig();
  return NextResponse.json({ config });
}

export async function POST(request: NextRequest) {
  const g = await guard(request, "MANAGE_PAYMENT_SETTINGS");
  if ("error" in g) return g.error;

  const body = (await request.json().catch(() => null)) as {
    action?: "gateway" | "dqr" | "method" | "upiMode" | "intent";
    gateway?: PaymentGateway;
    enabled?: boolean;
    method?: PaymentMethodFlag;
    upiMode?: UpiQrMode;
  } | null;
  if (!body || !body.action) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    if (body.action === "gateway") {
      if (body.gateway !== "PHONEPE" && body.gateway !== "RAZORPAY") {
        return NextResponse.json({ error: "Invalid gateway" }, { status: 400 });
      }
      const r = await setActivePaymentGateway(body.gateway, true);
      if (!r.success) {
        return NextResponse.json(
          { error: r.error ?? "Failed" },
          { status: 400 },
        );
      }
    } else if (body.action === "dqr") {
      const r = await setDqrEnabled(Boolean(body.enabled), true);
      if (!r.success) {
        return NextResponse.json(
          { error: r.error ?? "Failed" },
          { status: 400 },
        );
      }
    } else if (body.action === "method") {
      if (
        body.method !== "online" &&
        body.method !== "upi_qr" &&
        body.method !== "advance"
      ) {
        return NextResponse.json({ error: "Invalid method" }, { status: 400 });
      }
      const r = await setPaymentMethodEnabled(
        body.method,
        Boolean(body.enabled),
        true,
      );
      if (!r.success) {
        return NextResponse.json(
          { error: r.error ?? "Failed" },
          { status: 400 },
        );
      }
    } else if (body.action === "upiMode") {
      if (
        body.upiMode !== "STATIC" &&
        body.upiMode !== "DQR" &&
        body.upiMode !== "OFF"
      ) {
        return NextResponse.json({ error: "Invalid UPI mode" }, { status: 400 });
      }
      const r = await setUpiQrMode(body.upiMode, true);
      if (!r.success) {
        return NextResponse.json(
          { error: r.error ?? "Failed" },
          { status: 400 },
        );
      }
    } else if (body.action === "intent") {
      const r = await setIntentEnabled(Boolean(body.enabled), true);
      if (!r.success) {
        return NextResponse.json(
          { error: r.error ?? "Failed" },
          { status: 400 },
        );
      }
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update" },
      { status: 400 },
    );
  }

  const config = await getPaymentGatewayConfig();
  return NextResponse.json({ config });
}
