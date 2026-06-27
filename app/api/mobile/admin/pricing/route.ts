import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { getArenaSettings } from "@/actions/admin-arena-settings";
import type { DayType, TimeType } from "@prisma/client";

/**
 * Mobile admin pricing. GET mirrors getAllPricingData (3 reads) + arena hours;
 * POST upserts price rules (mirrors updatePricingRule/bulkUpdatePricing) and
 * arena hours (mirrors updateArenaSettings bounds) under MANAGE_PRICING.
 * Time-classification (PEAK/OFF_PEAK band) editing stays on web for now —
 * bands are returned read-only here.
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

  const [configs, rules, classifications, arena] = await Promise.all([
    db.courtConfig.findMany({
      where: { isActive: true },
      orderBy: [{ sport: "asc" }, { size: "asc" }],
    }),
    db.pricingRule.findMany(),
    db.timeClassification.findMany({ orderBy: { startHour: "asc" } }),
    getArenaSettings(),
  ]);

  return NextResponse.json({ configs, rules, classifications, arena });
}

export async function POST(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }

  if (body.action === "prices") {
    const updates = Array.isArray(body.updates) ? body.updates : [];
    for (const u of updates) {
      if (
        !u?.courtConfigId ||
        !["WEEKDAY", "WEEKEND"].includes(u.dayType) ||
        !["PEAK", "OFF_PEAK"].includes(u.timeType) ||
        !Number.isFinite(Number(u.pricePerSlot))
      ) {
        return NextResponse.json({ error: "Invalid price update" }, { status: 400 });
      }
      const pricePerSlot = Math.max(0, Math.trunc(Number(u.pricePerSlot)));
      await db.pricingRule.upsert({
        where: {
          courtConfigId_dayType_timeType: {
            courtConfigId: u.courtConfigId,
            dayType: u.dayType as DayType,
            timeType: u.timeType as TimeType,
          },
        },
        create: {
          courtConfigId: u.courtConfigId,
          dayType: u.dayType as DayType,
          timeType: u.timeType as TimeType,
          pricePerSlot,
        },
        update: { pricePerSlot },
      });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === "arena") {
    const open = Math.trunc(Number(body.openHour));
    const close = Math.trunc(Number(body.closeHour));
    if (!Number.isFinite(open) || open < 0 || open > 23) {
      return NextResponse.json({ error: "Opening hour must be 0–23." }, { status: 400 });
    }
    if (!Number.isFinite(close) || close < 1 || close > 29) {
      return NextResponse.json(
        { error: "Closing hour must be 1–29 (25 = 1am, 29 = 5am next day)." },
        { status: 400 },
      );
    }
    if (open >= close) {
      return NextResponse.json({ error: "Closing hour must be after opening hour." }, { status: 400 });
    }
    const existing = await db.arenaSettings.findFirst({ select: { id: true } });
    if (existing) {
      await db.arenaSettings.update({ where: { id: existing.id }, data: { openHour: open, closeHour: close } });
    } else {
      await db.arenaSettings.create({ data: { openHour: open, closeHour: close } });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
