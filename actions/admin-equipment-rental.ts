"use server";

import { db } from "@/lib/db";
import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";
import { revalidatePath } from "next/cache";

/**
 * Admin-only management of EquipmentRental rows on an existing
 * Booking. Lets the venue add rentals after the booking was created
 * (mobile/web customer flow only surfaces the picker pre-payment).
 *
 * The pricing model is intentionally simple: the rental TOTAL is
 * pegged to whatever the Equipment row currently charges in paise.
 * The customer agrees to "venue catalog price" when the admin adds
 * the row — there's no separate snapshot column for admin-added
 * rentals because the equipment catalog rarely changes during a
 * single session.
 *
 * Booking-level bookkeeping after each mutation:
 *   - Booking.equipmentTotalAmount  ← sum of all EquipmentRental rows (₹)
 *   - Booking.totalAmount            ← slot subtotal − discount + equipmentTotalAmount
 *
 * Payment columns are NOT touched. If the admin adds rentals to an
 * already-paid booking, the booking detail UI shows an "Outstanding"
 * pill computed off (Booking.totalAmount − Payment.amount).
 */

// Mobile callers authenticate via JWT outside the NextAuth cookie
// flow that `requireAdminBase` expects. The mobile API routes pass
// `adminIdOverride` once they've validated the JWT so this gate
// short-circuits cleanly instead of failing on a missing cookie.
async function requireBookingsAdmin(adminIdOverride?: string) {
  if (adminIdOverride) return adminIdOverride;
  const user = await requireAdminBase("MANAGE_BOOKINGS");
  return user.id;
}

interface AdminEquipmentRow {
  id: string;
  equipmentId: string;
  name: string;
  quantity: number;
  pricePerUnitPaise: number;
  totalPricePaise: number;
}

interface AdminEquipmentSnapshot {
  rentals: AdminEquipmentRow[];
  /** Rupees, mirror of Booking.equipmentTotalAmount. */
  equipmentTotalRupees: number;
  /** Rupees, mirror of Booking.totalAmount after recompute. */
  bookingTotalRupees: number;
}

/**
 * Recompute Booking.totalAmount + Booking.equipmentTotalAmount from
 * the current set of slot prices, discounts, and equipment rentals.
 * Must be called inside a transaction (or after every mutation).
 */
async function recomputeBookingTotals(
  bookingId: string,
): Promise<AdminEquipmentSnapshot> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      slots: true,
      equipmentRentals: { include: { equipment: true } },
    },
  });
  if (!booking) {
    throw new Error("Booking not found");
  }

  const slotTotal = booking.slots.reduce((s, slot) => s + slot.price, 0);
  // EquipmentRental.totalPrice is in paise; round to whole rupees so
  // Booking.totalAmount stays integer rupees like the rest of the
  // booking accounting.
  const equipmentTotalPaise = booking.equipmentRentals.reduce(
    (s, r) => s + r.totalPrice,
    0,
  );
  const equipmentTotalRupees = Math.round(equipmentTotalPaise / 100);

  // Booking.discountAmount already lives on the booking; keep it as-is.
  const newTotal =
    slotTotal - booking.discountAmount + equipmentTotalRupees;

  await db.booking.update({
    where: { id: bookingId },
    data: {
      equipmentTotalAmount: equipmentTotalRupees,
      totalAmount: newTotal,
    },
  });

  return {
    rentals: booking.equipmentRentals.map((r) => ({
      id: r.id,
      equipmentId: r.equipmentId,
      name: r.equipment.name,
      quantity: r.quantity,
      pricePerUnitPaise: r.equipment.pricePerHour,
      totalPricePaise: r.totalPrice,
    })),
    equipmentTotalRupees,
    bookingTotalRupees: newTotal,
  };
}

/**
 * Snapshot of the equipment rentals + totals for a booking. Used by
 * the admin booking detail page on first render.
 */
export async function getBookingEquipmentSnapshot(
  bookingId: string,
  adminIdOverride?: string,
): Promise<AdminEquipmentSnapshot> {
  await requireBookingsAdmin(adminIdOverride);
  return recomputeBookingTotals(bookingId);
}

/**
 * Add an equipment rental to a booking. If the equipment already has
 * a row, increment its quantity (and re-price totalPrice from the
 * live catalog). Otherwise insert a fresh row.
 */
/**
 * Number of BookingSlot rows attached to a booking. Used as the
 * scaling multiplier on rental rates — a 3-slot booking pays 3×
 * the rental rate per item per quantity. Returns at least 1 so a
 * pathological zero-slot row never zeroes out the bill.
 */
async function slotCountFor(bookingId: string): Promise<number> {
  const count = await db.bookingSlot.count({ where: { bookingId } });
  return Math.max(1, count);
}

/**
 * Re-price every EquipmentRental row attached to a booking against
 * the current slot count + live Equipment.pricePerHour. Call this
 * after an admin slot edit so the rental total scales with the new
 * slot count. Also refreshes Booking.equipmentTotalAmount + the
 * booking grand total via `recomputeBookingTotals`.
 *
 * Idempotent — safe to call from any path that mutates BookingSlots.
 */
export async function repriceBookingEquipment(bookingId: string): Promise<void> {
  const slots = await slotCountFor(bookingId);
  const rentals = await db.equipmentRental.findMany({
    where: { bookingId },
    include: { equipment: { select: { pricePerHour: true } } },
  });
  if (rentals.length === 0) return;
  await db.$transaction(
    rentals.map((r) =>
      db.equipmentRental.update({
        where: { id: r.id },
        data: {
          totalPrice: r.equipment.pricePerHour * r.quantity * slots,
        },
      }),
    ),
  );
  await recomputeBookingTotals(bookingId);
}

export async function addBookingEquipment(
  bookingId: string,
  equipmentId: string,
  quantity: number,
  adminIdOverride?: string,
): Promise<{ success: boolean; error?: string } & Partial<AdminEquipmentSnapshot>> {
  await requireBookingsAdmin(adminIdOverride);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { success: false, error: "Quantity must be a positive integer" };
  }

  const equipment = await db.equipment.findUnique({
    where: { id: equipmentId },
  });
  if (!equipment || !equipment.isActive) {
    return { success: false, error: "Equipment not available" };
  }

  const slots = await slotCountFor(bookingId);
  const existing = await db.equipmentRental.findFirst({
    where: { bookingId, equipmentId },
  });

  if (existing) {
    const newQty = existing.quantity + quantity;
    await db.equipmentRental.update({
      where: { id: existing.id },
      data: {
        quantity: newQty,
        totalPrice: equipment.pricePerHour * newQty * slots,
      },
    });
  } else {
    await db.equipmentRental.create({
      data: {
        bookingId,
        equipmentId,
        quantity,
        totalPrice: equipment.pricePerHour * quantity * slots,
      },
    });
  }

  const snapshot = await recomputeBookingTotals(bookingId);
  revalidatePath(`/admin/bookings/${bookingId}`);
  return { success: true, ...snapshot };
}

/**
 * Remove a single EquipmentRental row from the booking. Pass the
 * rental row id (not equipmentId) so deleting one of several rows
 * for the same item is unambiguous.
 */
export async function removeBookingEquipment(
  bookingId: string,
  rentalId: string,
  adminIdOverride?: string,
): Promise<{ success: boolean; error?: string } & Partial<AdminEquipmentSnapshot>> {
  await requireBookingsAdmin(adminIdOverride);

  const rental = await db.equipmentRental.findUnique({
    where: { id: rentalId },
  });
  if (!rental || rental.bookingId !== bookingId) {
    return { success: false, error: "Rental not found" };
  }

  await db.equipmentRental.delete({ where: { id: rentalId } });
  const snapshot = await recomputeBookingTotals(bookingId);
  revalidatePath(`/admin/bookings/${bookingId}`);
  return { success: true, ...snapshot };
}

/**
 * Update the quantity of an existing rental row, re-pricing from
 * the live catalog. Setting quantity to 0 deletes the row.
 */
export async function updateBookingEquipmentQuantity(
  bookingId: string,
  rentalId: string,
  quantity: number,
  adminIdOverride?: string,
): Promise<{ success: boolean; error?: string } & Partial<AdminEquipmentSnapshot>> {
  await requireBookingsAdmin(adminIdOverride);
  if (!Number.isInteger(quantity) || quantity < 0) {
    return { success: false, error: "Quantity must be a non-negative integer" };
  }

  const rental = await db.equipmentRental.findUnique({
    where: { id: rentalId },
    include: { equipment: true },
  });
  if (!rental || rental.bookingId !== bookingId) {
    return { success: false, error: "Rental not found" };
  }

  if (quantity === 0) {
    await db.equipmentRental.delete({ where: { id: rentalId } });
  } else {
    const slots = await slotCountFor(bookingId);
    await db.equipmentRental.update({
      where: { id: rentalId },
      data: {
        quantity,
        totalPrice: rental.equipment.pricePerHour * quantity * slots,
      },
    });
  }

  const snapshot = await recomputeBookingTotals(bookingId);
  revalidatePath(`/admin/bookings/${bookingId}`);
  return { success: true, ...snapshot };
}

/**
 * List the equipment catalog items an admin may add to bookings.
 * Filter is intentionally looser than the customer-facing list —
 * admin should see anything active + matching the booking's sport
 * (or sport-null), even if isCustomerSelectable=false.
 */
export async function listEquipmentForAdmin(
  bookingId: string,
  adminIdOverride?: string,
): Promise<
  Array<{
    id: string;
    name: string;
    pricePerUnitPaise: number;
    sport: string | null;
    category: string | null;
  }>
> {
  await requireBookingsAdmin(adminIdOverride);

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: { courtConfig: { select: { sport: true, category: true } } },
  });
  if (!booking) return [];

  const rows = await db.equipment.findMany({
    where: {
      isActive: true,
      OR: [{ sport: booking.courtConfig.sport }, { sport: null }],
      ...(booking.courtConfig.category
        ? {
            AND: [
              {
                OR: [
                  { category: booking.courtConfig.category },
                  { category: null },
                ],
              },
            ],
          }
        : {}),
    },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    pricePerUnitPaise: r.pricePerHour,
    sport: r.sport,
    category: r.category,
  }));
}

/**
 * Variant of `listEquipmentForAdmin` that doesn't require a booking
 * to exist yet — used by the admin Create Booking form to show the
 * equipment catalog after sport + court have been picked but before
 * the booking row is written.
 *
 * Same filter shape as the post-create list: active rows whose sport
 * matches (or is null) AND whose category matches the booking's
 * category (or is null). isCustomerSelectable is intentionally NOT
 * filtered — admin should see every active item, including
 * staff-only rentals.
 */
export async function listEquipmentForBookingCreate(
  sport: string,
  category: string | null,
  adminIdOverride?: string,
): Promise<
  Array<{
    id: string;
    name: string;
    pricePerUnitPaise: number;
    sport: string | null;
    category: string | null;
  }>
> {
  await requireBookingsAdmin(adminIdOverride);

  const rows = await db.equipment.findMany({
    where: {
      isActive: true,
      OR: [{ sport: sport as never }, { sport: null }],
      ...(category
        ? {
            AND: [
              {
                OR: [
                  { category: category as never },
                  { category: null },
                ],
              },
            ],
          }
        : {}),
    },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    pricePerUnitPaise: r.pricePerHour,
    sport: r.sport,
    category: r.category,
  }));
}
