import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { db } from "@/lib/db";
import { getValidHold } from "@/lib/slot-hold";
import { Prisma } from "@prisma/client";

/**
 * Mobile twin of the web `applyEquipmentSelectionToHold` server
 * action. Same validation: re-price every item server-side, refuse
 * anything not currently active + customer-selectable, snapshot
 * onto the hold so price edits between checkout and commit don't
 * change the customer's bill.
 *
 * POST { holdId, picks: [{equipmentId, quantity}] } — empty array
 * clears the selection.
 */
export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { holdId?: string; picks?: Array<{ equipmentId: string; quantity: number }> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { holdId, picks } = body;
  if (!holdId || !Array.isArray(picks)) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const hold = await getValidHold(holdId, user.id);
  if (!hold) {
    return NextResponse.json(
      { error: "Hold not found or expired" },
      { status: 404 },
    );
  }

  if (picks.length === 0) {
    await db.slotHold.update({
      where: { id: holdId },
      data: {
        equipmentSelection: Prisma.DbNull,
        equipmentTotalAmount: null,
      },
    });
    return NextResponse.json({ success: true, totalPaise: 0 });
  }

  const byId = new Map<string, number>();
  for (const p of picks) {
    if (!p.equipmentId || !Number.isInteger(p.quantity) || p.quantity <= 0) {
      return NextResponse.json({ success: false, error: "Invalid equipment selection" }, { status: 400 });
    }
    byId.set(p.equipmentId, (byId.get(p.equipmentId) ?? 0) + p.quantity);
  }

  const items = await db.equipment.findMany({
    where: {
      id: { in: Array.from(byId.keys()) },
      isActive: true,
      isCustomerSelectable: true,
    },
  });
  if (items.length !== byId.size) {
    return NextResponse.json(
      { success: false, error: "One of those items is no longer available" },
      { status: 400 },
    );
  }

  // Rental scales by slot count — same rule as the web hold path.
  // Mirrors actions/booking.ts so the customer sees the same total
  // no matter which surface they checkout from.
  const slotCount = Math.max(1, hold.hours.length);
  const snapshot = items.map((eq) => {
    const quantity = byId.get(eq.id) ?? 0;
    return {
      equipmentId: eq.id,
      name: eq.name,
      quantity,
      slotCount,
      priceEach: eq.pricePerHour,
      totalPrice: eq.pricePerHour * quantity * slotCount,
    };
  });
  const totalPaise = snapshot.reduce((s, e) => s + e.totalPrice, 0);
  const totalRupees = Math.round(totalPaise / 100);

  await db.slotHold.update({
    where: { id: holdId },
    data: {
      equipmentSelection: snapshot as unknown as Prisma.InputJsonValue,
      equipmentTotalAmount: totalRupees,
    },
  });

  return NextResponse.json({ success: true, totalPaise });
}
