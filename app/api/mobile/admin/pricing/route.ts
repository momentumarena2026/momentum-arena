import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import {
  getArenaSettings,
  getRainBannerConfig,
  getInfoBarConfig,
} from "@/actions/admin-arena-settings";
import type { DayType, TimeType } from "@prisma/client";

/**
 * Mobile admin pricing — full parity with the web /admin/pricing editor.
 *
 * GET mirrors getAllPricingData (configs + rules + classifications) + arena
 * hours. POST is action-dispatched:
 *   - "prices":      per-slot price upserts     (mirrors updatePricingRule)
 *   - "arena":       open/close window          (mirrors updateArenaSettings)
 *   - "band-save":   PEAK/OFF_PEAK band upsert  (mirrors updateTimeClassification)
 *   - "band-delete": drop a band               (mirrors deleteTimeClassification)
 *   - "rain-banner": banner mode + custom copy  (mirrors setRainBanner)
 *
 * Authorization: requireMobileAdmin(MANAGE_PRICING) — the SAME permission the
 * web actions enforce. This route inlines the equivalent DB writes (and
 * replicates the band overlap / hour-ordering checks verbatim) with the route
 * as the authorization boundary.
 *
 * UNITS: pricePerSlot is WHOLE RUPEES (the unit PricingRule stores). Band hours
 * are half-open [startHour, endHour); 0..29 where ≥24 = next day.
 */
export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_PRICING");
  if ("error" in gate) return gate.error;

  const [configs, rules, classifications, arena, rainBanner, infoBar] =
    await Promise.all([
      db.courtConfig.findMany({
        where: { isActive: true },
        orderBy: [{ sport: "asc" }, { size: "asc" }],
      }),
      db.pricingRule.findMany(),
      db.timeClassification.findMany({ orderBy: { startHour: "asc" } }),
      getArenaSettings(),
      getRainBannerConfig(),
      getInfoBarConfig(),
    ]);

  return NextResponse.json({ configs, rules, classifications, arena, rainBanner, infoBar });
}

export async function POST(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_PRICING");
  if ("error" in gate) return gate.error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }

  // --- Per-slot prices (WHOLE RUPEES) ---
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

  // --- Arena open/close window ---
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
    revalidateArena();
    return NextResponse.json({ ok: true });
  }

  // --- PEAK / OFF_PEAK band upsert (create + edit) ---
  // The (startHour, dayType) pair is the @@unique key: an upsert on an existing
  // startHour edits that band; a new startHour creates one. Mirrors the web
  // updateTimeClassification action — same bounds, ordering, and overlap guard.
  if (body.action === "band-save") {
    const startHour = Math.trunc(Number(body.startHour));
    const endHour = Math.trunc(Number(body.endHour));
    if (!Number.isFinite(startHour) || startHour < 0 || startHour > 28) {
      return NextResponse.json({ error: "Start hour must be 0–28." }, { status: 400 });
    }
    if (!Number.isFinite(endHour) || endHour < 1 || endHour > 29) {
      return NextResponse.json({ error: "End hour must be 1–29." }, { status: 400 });
    }
    if (!["WEEKDAY", "WEEKEND"].includes(body.dayType)) {
      return NextResponse.json({ error: "Invalid day type" }, { status: 400 });
    }
    if (!["PEAK", "OFF_PEAK"].includes(body.timeType)) {
      return NextResponse.json({ error: "Invalid time type" }, { status: 400 });
    }
    if (endHour <= startHour) {
      return NextResponse.json({ error: "End hour must be after start hour" }, { status: 400 });
    }
    const dayType = body.dayType as DayType;
    const timeType = body.timeType as TimeType;

    // Refuse to upsert a row whose hour range overlaps another band on the same
    // dayType — pricing lookup picks the first match by startHour ASC, so
    // overlaps silently mask each other. Exclude the row we'd overwrite at this
    // exact startHour (that's an update, not a conflict).
    const overlapping = await db.timeClassification.findFirst({
      where: {
        dayType,
        NOT: { startHour },
        AND: [{ startHour: { lt: endHour } }, { endHour: { gt: startHour } }],
      },
      select: { startHour: true, endHour: true, timeType: true },
    });
    if (overlapping) {
      return NextResponse.json(
        {
          error: `Range ${startHour}–${endHour} overlaps an existing ${dayType} band (${overlapping.startHour}–${overlapping.endHour} ${overlapping.timeType}). Delete that row first or adjust the hours.`,
        },
        { status: 400 },
      );
    }

    await db.timeClassification.upsert({
      where: { startHour_dayType: { startHour, dayType } },
      update: { endHour, timeType },
      create: { startHour, endHour, dayType, timeType },
    });
    revalidateArena();
    return NextResponse.json({ ok: true });
  }

  // --- Drop a band ---
  // Hours falling outside any band still book; they resolve to OFF_PEAK by
  // default (see lib/pricing.ts), so deletion widens off-peak coverage.
  if (body.action === "band-delete") {
    if (!body.id || typeof body.id !== "string") {
      return NextResponse.json({ error: "Band id is required" }, { status: 400 });
    }
    try {
      await db.timeClassification.delete({ where: { id: body.id } });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to delete band" },
        { status: 400 },
      );
    }
    revalidateArena();
    return NextResponse.json({ ok: true });
  }

  // --- "Rain doesn't slow us down" banner (ArenaSettings) ---
  // Mirrors the web setRainBanner action: mode falls back to AUTO on any
  // unexpected value, custom copy trims + caps at 200 chars (null = default).
  if (body.action === "info-bar") {
    const enabled = !!body.enabled;
    const text =
      typeof body.text === "string" && body.text.trim()
        ? body.text.trim().slice(0, 200)
        : null;
    const existing = await db.arenaSettings.findFirst({ select: { id: true } });
    if (existing) {
      await db.arenaSettings.update({
        where: { id: existing.id },
        data: { infoBarEnabled: enabled, infoBarText: text },
      });
    } else {
      await db.arenaSettings.create({
        data: { infoBarEnabled: enabled, infoBarText: text },
      });
    }
    try {
      revalidatePath("/");
    } catch {
      /* write landed */
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === "rain-banner") {
    const mode =
      body.mode === "ON" || body.mode === "OFF" ? body.mode : "AUTO";
    const text =
      typeof body.text === "string" && body.text.trim()
        ? body.text.trim().slice(0, 200)
        : null;
    const existing = await db.arenaSettings.findFirst({ select: { id: true } });
    if (existing) {
      await db.arenaSettings.update({
        where: { id: existing.id },
        data: { rainBannerMode: mode, rainBannerText: text },
      });
    } else {
      await db.arenaSettings.create({
        data: { rainBannerMode: mode, rainBannerText: text },
      });
    }
    // The banner renders on the homepage + booking page.
    try {
      revalidatePath("/");
      revalidatePath("/book");
    } catch {
      // write already landed; revalidation is best-effort
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

/** Best-effort revalidation of every surface that reads pricing/hours. */
function revalidateArena() {
  try {
    revalidatePath("/admin/pricing");
    revalidatePath("/admin/calendar");
    revalidatePath("/book");
  } catch {
    // write already landed; revalidation is best-effort
  }
}
