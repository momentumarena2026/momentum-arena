import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cancelWaitlist } from "@/actions/waitlist";
import { getMobileUser } from "@/lib/mobile-auth";

const bodySchema = z.object({
  waitlistId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const result = await cancelWaitlist(parsed.data.waitlistId, user.id);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
