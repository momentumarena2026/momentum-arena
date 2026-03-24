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

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function lockWithRetry(
  userId: string,
  configId: string,
  date: Date,
  slots: number[],
  slotPrices: { hour: number; price: number }[]
): Promise<LockResult> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await createSlotLock(
        userId,
        configId,
        date,
        slots,
        slotPrices
      );
      return result;
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : String(error);
      // Retry on deadlock/write conflict errors
      if (
        msg.includes("deadlock") ||
        msg.includes("write conflict") ||
        msg.includes("could not serialize")
      ) {
        if (attempt < MAX_RETRIES - 1) {
          await sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
      }
      throw error;
    }
  }
  return { success: false, error: "Failed after retries" };
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

    const results: BatchLockResult[] = [];

    // Process each item sequentially with delay to avoid serializable transaction deadlocks
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Small delay between locks to let previous transaction commit
      if (i > 0) {
        await sleep(300);
      }

      try {
        const date = new Date(item.date);

        const slotPrices = await getSlotPricesForDate(item.configId, date);
        const selectedPrices = slotPrices
          .filter((sp) => item.slots.includes(sp.hour))
          .map((sp) => ({ hour: sp.hour, price: sp.price }));

        const lockResult = await lockWithRetry(
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
