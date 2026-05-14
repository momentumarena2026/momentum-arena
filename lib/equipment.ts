import { db } from "@/lib/db";
import type { BookingCategory, Sport } from "@prisma/client";

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
