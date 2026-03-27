import { NextRequest, NextResponse } from "next/server";
import { expireUnverifiedUtrs } from "@/actions/upi-payment";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const count = await expireUnverifiedUtrs();
    return NextResponse.json({
      success: true,
      expired: count,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 500 }
    );
  }
}
