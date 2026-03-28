"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Sport } from "@prisma/client";

export async function getAvailableEquipment(
  sport: Sport | null,
  date: string,
  startHour: number,
  endHour: number
) {
  const durationHours = endHour - startHour;

  if (durationHours <= 0) {
    return { success: false, error: "Invalid time range", equipment: [] };
  }

  const bookingDate = new Date(date);
  bookingDate.setHours(0, 0, 0, 0);
  const bookingDateEnd = new Date(bookingDate);
  bookingDateEnd.setDate(bookingDateEnd.getDate() + 1);

  // Get all active equipment matching the sport filter
  const sportFilter = sport
    ? { OR: [{ sport: null }, { sport }] as const }
    : {};

  const allEquipment = await db.equipment.findMany({
    where: {
      isActive: true,
      ...sportFilter,
    },
    include: {
      rentals: {
        where: {
          booking: {
            date: { gte: bookingDate, lt: bookingDateEnd },
            status: { in: ["LOCKED", "CONFIRMED"] },
          },
        },
        include: {
          booking: {
            include: { slots: true },
          },
        },
      },
    },
  });

  // For each equipment, calculate how many units are available during the requested time window
  const available = allEquipment.map((eq) => {
    let rentedDuringWindow = 0;

    for (const rental of eq.rentals) {
      const slotHours = rental.booking.slots.map((s) => s.startHour);
      const hasOverlap = slotHours.some(
        (hour) => hour >= startHour && hour < endHour
      );
      if (hasOverlap) {
        rentedDuringWindow += rental.quantity;
      }
    }

    const availableUnits = Math.max(0, eq.totalUnits - rentedDuringWindow);

    return {
      id: eq.id,
      name: eq.name,
      sport: eq.sport,
      pricePerHour: eq.pricePerHour,
      totalPriceForDuration: eq.pricePerHour * durationHours,
      availableUnits,
      imageUrl: eq.imageUrl,
    };
  });

  // Only return equipment with at least 1 unit available
  const filteredAvailable = available.filter((eq) => eq.availableUnits > 0);

  return { success: true, equipment: filteredAvailable };
}

export interface EquipmentBookingResult {
  success: boolean;
  error?: string;
}

export async function addEquipmentToBooking(
  bookingId: string,
  items: { equipmentId: string; quantity: number }[]
): Promise<EquipmentBookingResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  if (items.length === 0) {
    return { success: false, error: "No items provided" };
  }

  // Verify booking belongs to user and is in valid status
  const booking = await db.booking.findUnique({
    where: { id: bookingId, userId: session.user.id },
    include: { slots: true },
  });

  if (!booking) {
    return { success: false, error: "Booking not found" };
  }

  if (booking.status === "CANCELLED") {
    return {
      success: false,
      error: "Cannot add equipment to a cancelled booking",
    };
  }

  if (booking.slots.length === 0) {
    return { success: false, error: "Booking has no slots" };
  }

  const durationHours = booking.slots.length;
  const startHour = Math.min(...booking.slots.map((s) => s.startHour));
  const endHour = Math.max(...booking.slots.map((s) => s.startHour)) + 1;

  const bookingDate = new Date(booking.date);
  bookingDate.setHours(0, 0, 0, 0);
  const bookingDateEnd = new Date(bookingDate);
  bookingDateEnd.setDate(bookingDateEnd.getDate() + 1);

  // Fetch all requested equipment with current rental info
  const equipmentIds = items.map((i) => i.equipmentId);
  const equipmentList = await db.equipment.findMany({
    where: { id: { in: equipmentIds }, isActive: true },
    include: {
      rentals: {
        where: {
          booking: {
            date: { gte: bookingDate, lt: bookingDateEnd },
            status: { in: ["LOCKED", "CONFIRMED"] },
            id: { not: bookingId },
          },
        },
        include: {
          booking: { include: { slots: true } },
        },
      },
    },
  });

  if (equipmentList.length !== equipmentIds.length) {
    return {
      success: false,
      error: "One or more equipment items not found or inactive",
    };
  }

  // Validate availability for each item
  for (const item of items) {
    if (item.quantity <= 0) {
      return { success: false, error: "Quantity must be at least 1" };
    }

    const equipment = equipmentList.find((e) => e.id === item.equipmentId);
    if (!equipment) {
      return {
        success: false,
        error: `Equipment not found: ${item.equipmentId}`,
      };
    }

    let rentedDuringWindow = 0;
    for (const rental of equipment.rentals) {
      const slotHours = rental.booking.slots.map((s) => s.startHour);
      const hasOverlap = slotHours.some(
        (hour) => hour >= startHour && hour < endHour
      );
      if (hasOverlap) {
        rentedDuringWindow += rental.quantity;
      }
    }

    const availableUnits = equipment.totalUnits - rentedDuringWindow;

    if (item.quantity > availableUnits) {
      return {
        success: false,
        error: `Not enough units available for ${equipment.name}. Available: ${availableUnits}`,
      };
    }
  }

  const equipmentPriceMap = new Map(
    equipmentList.map((e) => [e.id, e.pricePerHour])
  );

  // Replace existing rentals for these items on this booking
  await db.$transaction([
    db.equipmentRental.deleteMany({
      where: { bookingId, equipmentId: { in: equipmentIds } },
    }),
    db.equipmentRental.createMany({
      data: items.map((item) => ({
        bookingId,
        equipmentId: item.equipmentId,
        quantity: item.quantity,
        totalPrice:
          (equipmentPriceMap.get(item.equipmentId) || 0) *
          durationHours *
          item.quantity,
      })),
    }),
  ]);

  return { success: true };
}

export async function removeEquipmentFromBooking(
  bookingId: string,
  equipmentId: string
): Promise<EquipmentBookingResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  const booking = await db.booking.findUnique({
    where: { id: bookingId, userId: session.user.id },
  });

  if (!booking) {
    return { success: false, error: "Booking not found" };
  }

  if (booking.status === "CANCELLED") {
    return { success: false, error: "Cannot modify a cancelled booking" };
  }

  const deleted = await db.equipmentRental.deleteMany({
    where: { bookingId, equipmentId },
  });

  if (deleted.count === 0) {
    return { success: false, error: "Equipment rental not found" };
  }

  return { success: true };
}
