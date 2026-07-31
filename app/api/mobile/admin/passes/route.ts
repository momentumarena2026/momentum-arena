import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import {
  getPassesEnabled,
  setPassesEnabled,
  getPassAdminData,
  createPassPlan,
  updatePassPlan,
  togglePassPlan,
  setPassCheapestHour,
  deletePassPlan,
  issuePassToUser,
  giftCustomPass,
  getSoldPasses,
  extendPassValidity,
  adjustPassMinutes,
  cancelUserPass,
  setPassSharingLimit,
} from "@/actions/admin-passes";
import { parseBands } from "@/lib/pass-bands";

/**
 * Mobile admin passes — FULL parity with the web admin passes hub
 * (app/(admin)/admin/passes + actions/admin-passes.ts) under
 * MANAGE_PASSES. GET returns everything the screen renders (storefront
 * switch, grouped court configs w/ rates + sharing caps, plans w/
 * pricing-valid flags, sold passes); POST dispatches every mutation via
 * { action, ...payload }. requireMobileAdmin here returns proper
 * 401/403 JSON; the actions independently re-run requireAdmin
 * ("MANAGE_PASSES"), which resolves this request's Bearer JWT, so the
 * gate holds even if this route is ever bypassed.
 */

export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_PASSES");
  if ("error" in gate) return gate.error;

  const [enabled, adminData, sold] = await Promise.all([
    getPassesEnabled(),
    getPassAdminData(),
    getSoldPasses(),
  ]);
  return NextResponse.json({
    enabled,
    configs: adminData.configs,
    plans: adminData.plans,
    sold,
  });
}

export async function POST(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_PASSES");
  if ("error" in gate) return gate.error;

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ ok: false, error: "Missing action" }, { status: 400 });
  }

  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
  const num = (k: string) => Number(body[k]);

  try {
    switch (body.action) {
      case "set-enabled": {
        await setPassesEnabled(!!body.enabled);
        return NextResponse.json({ ok: true });
      }
      case "create-plan": {
        const result = await createPassPlan(
          {
            courtConfigId: str("courtConfigId"),
            totalHours: num("totalHours"),
            bands: parseBands(body.bands),
            discountPercent: num("discountPercent"),
            validityDays: num("validityDays"),
            name: str("name") || undefined,
          },
    );
        return NextResponse.json(result);
      }
      case "update-plan": {
        const result = await updatePassPlan(
          str("id"),
          {
            totalHours: num("totalHours"),
            bands: parseBands(body.bands),
            discountPercent: num("discountPercent"),
            validityDays: num("validityDays"),
            name: str("name") || undefined,
          },
    );
        return NextResponse.json(result);
      }
      case "toggle-plan": {
        const result = await togglePassPlan(str("id"), !!body.isActive);
        return NextResponse.json(result);
      }
      case "set-cheapest-hour": {
        const result = await setPassCheapestHour(str("id"), !!body.on);
        return NextResponse.json(result);
      }
      case "delete-plan": {
        const result = await deletePassPlan(str("id"));
        return NextResponse.json(result);
      }
      case "issue": {
        const method = str("paymentMethod");
        if (method !== "CASH" && method !== "UPI_QR" && method !== "FREE") {
          return NextResponse.json({ ok: false, error: "Invalid payment method." });
        }
        const result = await issuePassToUser(
          {
            planId: str("planId"),
            userId: str("userId"),
            paymentMethod: method,
            amountCollected:
              body.amountCollected == null ? undefined : num("amountCollected"),
            offlineRef: str("offlineRef") || undefined,
            startDate: str("startDate") || undefined,
          },
    );
        return NextResponse.json(result);
      }
      case "gift": {
        const result = await giftCustomPass(
          {
            userId: str("userId"),
            courtConfigId: str("courtConfigId"),
            totalHours: num("totalHours"),
            validityDays: num("validityDays"),
            bands: parseBands(body.bands),
            name: str("name") || undefined,
            value: body.value == null ? undefined : num("value"),
            note: str("note") || undefined,
            startDate: str("startDate") || undefined,
          },
    );
        return NextResponse.json(result);
      }
      case "extend": {
        const result = await extendPassValidity(str("id"), num("extraDays"));
        return NextResponse.json(result);
      }
      case "adjust-minutes": {
        const result = await adjustPassMinutes(str("id"), num("deltaMinutes"));
        return NextResponse.json(result);
      }
      case "cancel": {
        const result = await cancelUserPass(str("id"));
        return NextResponse.json(result);
      }
      case "set-sharing": {
        const result = await setPassSharingLimit(
          str("courtConfigId"),
          num("max"),
    );
        return NextResponse.json(result);
      }
      default:
        return NextResponse.json(
          { ok: false, error: `Unknown action: ${body.action}` },
          { status: 400 },
        );
    }
  } catch (error) {
    console.error("[mobile-admin] passes action failed", body.action, error);
    return NextResponse.json(
      { ok: false, error: "Something went wrong. Try again." },
      { status: 500 },
    );
  }
}
