import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { joinWaitlist } from "@/actions/waitlist";
import { getMobileUser } from "@/lib/mobile-auth";

const bodySchema = z.object({
  courtConfigId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(1).max(24),
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

  const result = await joinWaitlist({
    ...parsed.data,
    userIdOverride: user.id,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true, waitlistId: result.waitlistId });
}
