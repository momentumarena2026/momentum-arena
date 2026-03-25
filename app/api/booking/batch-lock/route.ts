import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createBatchSlotLocks } from "@/lib/slot-lock";
import { getSlotPricesForDate } from "@/lib/pricing";

interface BatchLockItem {
  itemId: string;
  configId: string;
  date: string;
  slots: number[];
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { items } = (await request.json()) as { items: BatchLockItem[] };

    if (!items || items.length === 0) {
      return NextResponse.json(
        { error: "No items provided" },
        { status: 400 }
      );
    }

    if (items.length > 10) {
      return NextResponse.json(
        { error: "Maximum 10 items per cart" },
        { status: 400 }
      );
    }

    // Prepare items with prices
    const preparedItems = await Promise.all(
      items.map(async (item) => {
        const date = new Date(item.date);
        const slotPrices = await getSlotPricesForDate(item.configId, date);
        const selectedPrices = slotPrices
          .filter((sp) => item.slots.includes(sp.hour))
          .map((sp) => ({ hour: sp.hour, price: sp.price }));

        return {
          itemId: item.itemId,
          configId: item.configId,
          date,
          hours: item.slots,
          slotPrices: selectedPrices,
        };
      })
    );

    // Use advisory-lock-based batch locking — no deadlocks, no retries needed
    const { results } = await createBatchSlotLocks(
      session.user.id,
      preparedItems
    );

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
