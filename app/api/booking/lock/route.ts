import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { createSlotLock } from "@/lib/slot-lock";
import { getSlotPricesForDate } from "@/lib/pricing";

export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const courtConfigId = formData.get("courtConfigId") as string;
  const date = formData.get("date") as string;
  const hours = JSON.parse(formData.get("hours") as string) as number[];

  if (!courtConfigId || !date || !hours?.length) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const bookingDate = new Date(date);
  const allPrices = await getSlotPricesForDate(courtConfigId, bookingDate);
  const slotPrices = hours.map((hour) => {
    const priceData = allPrices.find((p) => p.hour === hour);
    return { hour, price: priceData?.price ?? 0 };
  });

  const result = await createSlotLock(
    userId,
    courtConfigId,
    bookingDate,
    hours,
    slotPrices
  );

  return NextResponse.json(result);
}
