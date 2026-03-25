import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { getSlotAvailability } from "@/lib/availability";

export async function GET(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const configId = searchParams.get("configId");
  const date = searchParams.get("date");

  if (!configId || !date) {
    return NextResponse.json(
      { error: "configId and date are required" },
      { status: 400 }
    );
  }

  try {
    const slots = await getSlotAvailability(configId, new Date(date));
    return NextResponse.json({ slots });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get availability" },
      { status: 500 }
    );
  }
}
