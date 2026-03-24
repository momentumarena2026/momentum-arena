import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createSlotLock, type LockResult } from "@/lib/slot-lock";
import { getSlotPricesForDate } from "@/lib/pricing";

interface BatchLockItem {
  itemId: string;
  configId: string;
  date: string;
  slots: number[];
}

interface BatchLockResult {
  itemId: string;
  status: "locked" | "conflict";
  bookingId?: string;
  error?: string;
  conflictingHours?: number[];
  lockExpiresAt?: string;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { items } = (await request.json()) as { items: BatchLockItem[] };

    if (!items || items.length === 0) {
      return NextResponse.json({ error: "No items provided" }, { status: 400 });
    }

    if (items.length > 10) {
      return NextResponse.json(
        { error: "Maximum 10 items per cart" },
        { status: 400 }
      );
    }

    const results: BatchLockResult[] = [];

    // Process each item sequentially to avoid race conditions between cart items
    for (const item of items) {
      try {
        const date = new Date(item.date);

        // Get slot prices for the date
        const slotPrices = await getSlotPricesForDate(item.configId, date);
        const selectedPrices = slotPrices
          .filter((sp) => item.slots.includes(sp.hour))
          .map((sp) => ({ hour: sp.hour, price: sp.price }));

        const lockResult: LockResult = await createSlotLock(
          session.user.id,
          item.configId,
          date,
          item.slots,
          selectedPrices
        );

        if (lockResult.success && lockResult.bookingId) {
          const lockExpiresAt = new Date(
            Date.now() + 5 * 60 * 1000
          ).toISOString();

          results.push({
            itemId: item.itemId,
            status: "locked",
            bookingId: lockResult.bookingId,
            lockExpiresAt,
          });
        } else {
          results.push({
            itemId: item.itemId,
            status: "conflict",
            error: lockResult.error || "Failed to lock slots",
            conflictingHours: lockResult.conflicts,
          });
        }
      } catch (error) {
        results.push({
          itemId: item.itemId,
          status: "conflict",
          error:
            error instanceof Error ? error.message : "Failed to lock slots",
        });
      }
    }

    const allLocked = results.every((r) => r.status === "locked");

    return NextResponse.json({
      success: allLocked,
      results,
      lockedCount: results.filter((r) => r.status === "locked").length,
      conflictCount: results.filter((r) => r.status === "conflict").length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Batch lock failed",
      },
      { status: 500 }
    );
  }
}
