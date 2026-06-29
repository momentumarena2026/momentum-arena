import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { sendPinChangedEmail } from "@/lib/generator-notifications";

/**
 * Generator config (singleton). Mirrors getGeneratorConfig +
 * updateGeneratorConfig in actions/generator.ts. Money fields
 * (petrolPricePerLitre, oilPricePerLitre) are PAISE in the DB and on
 * the wire — the mobile screen converts to/from rupees for display.
 *
 * Gated by MANAGE_PRICING (web sidebar rule for /admin/generator).
 */
async function getOrCreateConfig() {
  let config = await db.generatorConfig.findFirst();
  if (!config) config = await db.generatorConfig.create({ data: {} });
  return config;
}

export async function GET(request: NextRequest) {
  const g = await requireMobileAdmin(request, "MANAGE_PRICING");
  if ("error" in g) return g.error;

  const config = await getOrCreateConfig();
  return NextResponse.json({ config });
}

const configSchema = z.object({
  petrolPricePerLitre: z.number().int().min(0), // paise
  oilPricePerLitre: z.number().int().min(0), // paise
  consumptionRate: z.number().min(0),
  firstOilChangeHours: z.number().int().min(0),
  secondOilChangeHours: z.number().int().min(0),
  regularOilChangeHours: z.number().int().min(0),
  oilChangeAlertHours: z.number().int().min(0),
  notificationEmails: z.string(),
  oilChangeTemplateId: z.string(),
  monthlyTemplateId: z.string(),
  pinChangeTemplateId: z.string(),
  generatorPin: z.string().regex(/^\d{6}$/, "PIN must be exactly 6 digits"),
  hardwareApiKey: z.string(),
  pinChanged: z.boolean().optional(),
});

export async function PUT(request: NextRequest) {
  const g = await requireMobileAdmin(request, "MANAGE_PRICING");
  if ("error" in g) return g.error;

  const parsed = configSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid data" },
      { status: 400 },
    );
  }
  const { pinChanged, ...updateData } = parsed.data;

  try {
    const config = await getOrCreateConfig();
    await db.generatorConfig.update({
      where: { id: config.id },
      data: updateData,
    });

    // Send PIN change email if PIN was changed (mirror web action).
    if (pinChanged && updateData.generatorPin) {
      const adminName = g.admin.username || "Admin";
      sendPinChangedEmail({
        newPin: updateData.generatorPin,
        changedBy: adminName,
        changedAt: new Date().toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          dateStyle: "medium",
          timeStyle: "short",
        }),
        adminUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://momentumarena.com"}/admin/generator`,
      }).catch((err) => console.error("PIN change email error:", err));
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("updateGeneratorConfig error:", e);
    return NextResponse.json(
      { error: "Failed to update config" },
      { status: 500 },
    );
  }
}
