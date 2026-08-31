import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { getSoldPassDetail } from "@/actions/admin-passes";

/**
 * One sold pass, in full — the app's twin of /admin/passes/[id] on web.
 *
 * Reuses getSoldPassDetail rather than assembling its own query, so the
 * balance, consumed hours and redemption list the phone shows can never
 * disagree with the web admin or with the customer's own pass screen. All
 * three read the same core (lib/passes buildPassDetail).
 *
 * requireMobileAdmin returns proper 401/403 JSON; getSoldPassDetail
 * independently re-runs requireAdmin("MANAGE_PASSES") against this
 * request's Bearer JWT, so the gate holds even if this route is bypassed.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_PASSES");
  if ("error" in gate) return gate.error;

  const { id } = await params;
  const pass = await getSoldPassDetail(id);
  if (!pass) {
    return NextResponse.json({ error: "Pass not found" }, { status: 404 });
  }
  return NextResponse.json(pass);
}
