import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { createCustomerForBooking } from "@/actions/admin-booking";

/**
 * POST /api/mobile/admin/customers/create
 * body: { name, phone, email? }
 *
 * Idempotent on phone — if a User with that phone already exists,
 * returns isNew=false with the existing id. The mobile create-
 * booking form uses this when the admin types in a name+phone for
 * a customer who isn't found by search.
 */
const Body = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().min(10).max(20),
  email: z.string().email().optional(),
});

export async function POST(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid body" },
      { status: 400 },
    );
  }

  const result = await createCustomerForBooking(parsed.data, true);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, userId: result.userId, isNew: result.isNew });
}
