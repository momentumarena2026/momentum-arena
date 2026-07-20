import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import {
  getRecurringConfig,
  updateRecurringConfig,
} from "@/actions/admin-recurring";

/**
 * Mobile admin recurring-booking config. Mirrors web /admin/recurring
 * (actions/admin-recurring.ts getRecurringConfig + updateRecurringConfig):
 * weekly + daily discount tiers, allowed days, and week/day booking
 * limits for the recurring-series flow.
 *
 * `discountPercent` and `tier.weeks`/`tier.days` are whole numbers (a
 * percent is a percent — not basis points here). allowedDays uses
 * 0=Sun … 6=Sat. Gated on MANAGE_PRICING.
 */
async function guard(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_PRICING")
  ) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

export async function GET(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;

  const config = await getRecurringConfig();
  return NextResponse.json({ config });
}

const tierSchema = z.object({
  weeks: z.number().int(),
  discountPercent: z.number(),
});
const dailyTierSchema = z.object({
  days: z.number().int(),
  discountPercent: z.number(),
});
const bodySchema = z.object({
  tiers: z.array(tierSchema),
  allowedDays: z.array(z.number().int().min(0).max(6)),
  maxWeeks: z.number().int(),
  minWeeks: z.number().int(),
  dailyTiers: z.array(dailyTierSchema),
  maxDays: z.number().int(),
  minDays: z.number().int(),
  enabled: z.boolean(),
});

export async function POST(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid data" },
      { status: 400 },
    );
  }

  const result = await updateRecurringConfig(parsed.data);
  if (!result.success) {
    return NextResponse.json(
      { error: result.error ?? "Update failed" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
