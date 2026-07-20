import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { listEquipmentForBookingCreate } from "@/actions/admin-equipment-rental";

/**
 * GET /api/mobile/admin/equipment-for-booking?sport=&category=
 *
 * Equipment catalog for the mobile admin create-booking form,
 * filtered to a sport + optional category. Mirrors the web action
 * `listEquipmentForBookingCreate` — bookingId-less variant of the
 * post-create catalog so the form can render the picker before any
 * booking row exists.
 *
 * Response: { items: Array<{id, name, pricePerUnitPaise, sport,
 * category}> }
 */
export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_BOOKINGS");
  if ("error" in gate) return gate.error;

  const { searchParams } = new URL(request.url);
  const sport = searchParams.get("sport");
  const category = searchParams.get("category"); // can be empty / null

  if (!sport) {
    return NextResponse.json({ error: "sport is required" }, { status: 400 });
  }

  const items = await listEquipmentForBookingCreate(
    sport,
    category && category.length > 0 ? category : null,
  );
  return NextResponse.json({ items });
}
