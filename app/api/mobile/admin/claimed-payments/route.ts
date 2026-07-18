import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { resolveClaimedPayment } from "@/actions/admin-claimed-payments";

/**
 * POST /api/mobile/admin/claimed-payments
 *
 * App-side twin of the web "Unconfirmed Payments" cafe/pass actions.
 * Body: { kind: "cafe" | "pass", intentId, mode: "verify" | "force" | "reject" }
 *
 * The action itself is shared, so the app and the web console can't
 * drift on what "verify" means: it re-asks PhonePe first, and only a
 * `force` (chosen deliberately after PhonePe refused) materialises
 * anything on the admin's own authority.
 */
export async function POST(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_BOOKINGS");
  if ("error" in gate) return gate.error;

  const body = await request.json().catch(() => ({}));
  const kind = body?.kind;
  const intentId = body?.intentId;
  const mode = body?.mode;
  if (
    (kind !== "cafe" && kind !== "pass") ||
    typeof intentId !== "string" ||
    !["verify", "force", "reject"].includes(mode)
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const result = await resolveClaimedPayment(kind, intentId, mode, true);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
