import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDqrConfigured } from "@/lib/phonepe-dqr";

// GET /api/mobile/settings/payment-config — public.
// Mirrors `getCheckoutPaymentConfig` (actions/admin-payment-settings.ts).
// The mobile checkout needs to know which payment method tiles to render
// and which gateway is active before it can show anything, so this runs
// unauthenticated just like the web equivalent.
export async function GET() {
  const config = await db.paymentGatewayConfig.findUnique({
    where: { id: "singleton" },
  });
  const dqrConfigured = isDqrConfigured();

  if (!config) {
    // Fresh DB fallback — admin hasn't touched payment settings yet.
    return NextResponse.json({
      activeGateway: "PHONEPE",
      onlineEnabled: true,
      upiQrEnabled: true,
      advanceEnabled: true,
      dqrEnabled: false,
    });
  }

  return NextResponse.json({
    activeGateway: config.activeGateway,
    onlineEnabled: config.onlineEnabled,
    upiQrEnabled: config.upiQrEnabled,
    advanceEnabled: config.advanceEnabled,
    // Effective DQR requires both the admin toggle and live creds.
    dqrEnabled: config.dqrEnabled && dqrConfigured,
  });
}
