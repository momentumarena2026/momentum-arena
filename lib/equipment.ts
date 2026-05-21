import { db } from "@/lib/db";
import type { BookingCategory, Prisma, Sport } from "@prisma/client";

/**
 * Customer-facing equipment list for a given booking context.
 *
 * Filters:
 *   - active + customer-selectable
 *   - sport matches OR is null (a venue-wide kit not tied to a sport)
 *   - category matches OR is null (item available across cricket flows)
 *
 * Sorted by displayOrder ascending, with a stable createdAt tiebreaker
 * so the customer checkout sees the same sequence the admin configured
 * in /admin/equipment. Read by both web and mobile checkout flows.
 */
export interface EquipmentOption {
  id: string;
  name: string;
  pricePaise: number;
  imageUrl: string | null;
}

export async function listEquipmentForBooking(args: {
  sport: Sport;
  category: BookingCategory | null;
}): Promise<EquipmentOption[]> {
  const rows = await db.equipment.findMany({
    where: {
      isActive: true,
      isCustomerSelectable: true,
      // Match the sport exactly OR allow venue-wide items (sport null).
      OR: [{ sport: args.sport }, { sport: null }],
      // Same idea for category. When the caller passes null (non-
      // cricket or pre-categorised), we still include items that
      // explicitly target a category — those just won't be relevant
      // and the caller will choose not to render them.
      ...(args.category
        ? { AND: [{ OR: [{ category: args.category }, { category: null }] }] }
        : { category: null }),
    },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    // pricePerHour column historically meant "per hour"; for the
    // bowling-machine flow + the new generic rental model we treat
    // it as a flat per-booking ₹ price in paise.
    pricePaise: r.pricePerHour,
    imageUrl: r.imageUrl,
  }));
}

/**
 * Shape persisted on `SlotHold.equipmentSelection`. Each entry is a
 * point-in-time snapshot — name + priceEach are captured so admin
 * price edits between checkout and commit don't change what the
 * customer agreed to. Total per item is paise.
 */
export interface EquipmentSnapshotItem {
  equipmentId: string;
  name: string;
  quantity: number;
  slotCount: number;
  priceEach: number; // paise
  totalPrice: number; // paise
}

export interface EquipmentSnapshotResult {
  snapshot: EquipmentSnapshotItem[];
  totalPaise: number;
  totalRupees: number; // round(totalPaise / 100) — matches the existing rupees fields on Booking/SlotHold
}

/**
 * Validate + price a customer's equipment picks against the live
 * Equipment rows. Shared between the on-checkout `applyEquipment-
 * SelectionToHold` server action and the at-lock-time path on
 * /api/booking/lock, so both surfaces use identical pricing math.
 *
 * Does NOT touch the SlotHold — caller writes the snapshot back
 * however it likes (own update, inside its own transaction, etc).
 *
 * Rental price is per-slot: `priceEach × quantity × slotCount`. For
 * hourly bookings each slot is 1 hour; for bowling-machine bookings
 * each "slot" is 30 minutes but we still scale linearly by hold-row
 * count (3 × 30min slots → 3× rental fee). Matches the existing
 * `applyEquipmentSelectionToHold` semantics.
 */
export async function snapshotEquipmentForHold(
  picks: Array<{ equipmentId: string; quantity: number }>,
  slotCount: number,
  client?: Prisma.TransactionClient,
): Promise<
  | { ok: true; result: EquipmentSnapshotResult }
  | { ok: false; error: string }
> {
  if (picks.length === 0) {
    return { ok: true, result: { snapshot: [], totalPaise: 0, totalRupees: 0 } };
  }

  // Dedupe + validate
  const byId = new Map<string, number>();
  for (const p of picks) {
    if (!p.equipmentId || !Number.isInteger(p.quantity) || p.quantity <= 0) {
      return { ok: false, error: "Invalid equipment selection" };
    }
    byId.set(p.equipmentId, (byId.get(p.equipmentId) ?? 0) + p.quantity);
  }

  const c = client ?? db;
  const items = await c.equipment.findMany({
    where: {
      id: { in: Array.from(byId.keys()) },
      isActive: true,
      isCustomerSelectable: true,
    },
  });
  if (items.length !== byId.size) {
    return {
      ok: false,
      error: "One of those items is no longer available",
    };
  }

  const safeSlotCount = Math.max(1, slotCount);
  const snapshot: EquipmentSnapshotItem[] = items.map((eq) => {
    const quantity = byId.get(eq.id) ?? 0;
    const totalPrice = eq.pricePerHour * quantity * safeSlotCount; // paise
    return {
      equipmentId: eq.id,
      name: eq.name,
      quantity,
      slotCount: safeSlotCount,
      priceEach: eq.pricePerHour,
      totalPrice,
    };
  });
  const totalPaise = snapshot.reduce((sum, e) => sum + e.totalPrice, 0);
  const totalRupees = Math.round(totalPaise / 100);
  return { ok: true, result: { snapshot, totalPaise, totalRupees } };
}
