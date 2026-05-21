import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
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
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sport = searchParams.get("sport");
  const category = searchParams.get("category"); // can be empty / null

  if (!sport) {
    return NextResponse.json({ error: "sport is required" }, { status: 400 });
  }

  const items = await listEquipmentForBookingCreate(
    sport,
    category && category.length > 0 ? category : null,
    admin.id,
  );
  return NextResponse.json({ items });
}
