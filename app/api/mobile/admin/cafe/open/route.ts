import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { getCafeSettings, setCafeOpen } from "@/actions/cafe-settings";

/**
 * Cafe master open/closed switch for the mobile admin Cafe Menu
 * screen — mirrors the web cafe-open-toggle.tsx (CafeSettings.isOpen).
 *
 *   GET  → { isOpen }              read current state
 *   POST → { isOpen } body        set new state, returns { ok, isOpen }
 *
 * Drives the customer-facing /cafe page + mobile Cafe tab. Admin
 * walk-in ordering is unaffected.
 *
 * Auth: requireMobileAdmin re-enforces MANAGE_CAFE_MENU here, then the
 * web action runs with skipAuth=true (NextAuth web-cookie bypass).
 * getCafeSettings has no auth gate of its own (it's read by the public
 * /cafe page too), so the GET only needs the route-level guard.
 */
export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_CAFE_MENU");
  if ("error" in gate) return gate.error;

  const settings = await getCafeSettings();
  return NextResponse.json({ isOpen: Boolean(settings?.isOpen ?? true) });
}

export async function POST(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_CAFE_MENU");
  if ("error" in gate) return gate.error;

  const body = await request.json().catch(() => null);
  if (!body || typeof (body as Record<string, unknown>).isOpen !== "boolean") {
    return NextResponse.json({ error: "isOpen (boolean) required" }, { status: 400 });
  }

  const result = await setCafeOpen((body as { isOpen: boolean }).isOpen, true);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, isOpen: result.isOpen });
}
