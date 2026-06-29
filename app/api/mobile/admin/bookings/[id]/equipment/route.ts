import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import {
  addBookingEquipment,
  getBookingEquipmentSnapshot,
  listEquipmentForAdmin,
  removeBookingEquipment,
  updateBookingEquipmentQuantity,
} from "@/actions/admin-equipment-rental";

/**
 * GET /api/mobile/admin/bookings/[id]/equipment
 *
 * Returns the current EquipmentRental rows for the booking, the
 * catalog of items an admin can add, and the recomputed booking
 * totals — same shape the web detail page renders.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_BOOKINGS");
  if ("error" in gate) return gate.error;
  const admin = gate.admin;

  const { id } = await params;
  try {
    const [snapshot, catalog] = await Promise.all([
      getBookingEquipmentSnapshot(id, admin.id),
      listEquipmentForAdmin(id, admin.id),
    ]);
    return NextResponse.json({
      rentals: snapshot.rentals,
      catalog,
      equipmentTotalRupees: snapshot.equipmentTotalRupees,
      bookingTotalRupees: snapshot.bookingTotalRupees,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 400 },
    );
  }
}

/**
 * POST /api/mobile/admin/bookings/[id]/equipment
 *
 * Body shapes:
 *   { op: "add",    equipmentId, quantity }
 *   { op: "update", rentalId, quantity }   // quantity=0 deletes
 *   { op: "remove", rentalId }
 *
 * Each mutation responds with the recomputed snapshot so the mobile
 * editor can refresh in one round-trip.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_BOOKINGS");
  if ("error" in gate) return gate.error;
  const admin = gate.admin;

  const { id } = await params;
  let body: {
    op?: "add" | "update" | "remove";
    equipmentId?: string;
    rentalId?: string;
    quantity?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    if (body.op === "add") {
      if (!body.equipmentId || typeof body.quantity !== "number") {
        return NextResponse.json(
          { error: "equipmentId and quantity required" },
          { status: 400 },
        );
      }
      const res = await addBookingEquipment(
        id,
        body.equipmentId,
        body.quantity,
        admin.id,
      );
      return NextResponse.json(res);
    }
    if (body.op === "update") {
      if (!body.rentalId || typeof body.quantity !== "number") {
        return NextResponse.json(
          { error: "rentalId and quantity required" },
          { status: 400 },
        );
      }
      const res = await updateBookingEquipmentQuantity(
        id,
        body.rentalId,
        body.quantity,
        admin.id,
      );
      return NextResponse.json(res);
    }
    if (body.op === "remove") {
      if (!body.rentalId) {
        return NextResponse.json(
          { error: "rentalId required" },
          { status: 400 },
        );
      }
      const res = await removeBookingEquipment(id, body.rentalId, admin.id);
      return NextResponse.json(res);
    }
    return NextResponse.json({ error: "Unknown op" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 400 },
    );
  }
}
