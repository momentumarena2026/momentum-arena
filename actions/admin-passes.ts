"use server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { revalidatePath } from "next/cache";

/**
 * Monthly Passes — admin plan management (Phase 1 of the passes
 * module). A PassPlan sells N hours on one court config at a
 * discounted effective hourly rate, valid for validityDays from
 * purchase. Customer purchase + redemption land in later phases.
 */

const PERMISSION = "MANAGE_PASSES" as const;

export interface PassConfigOption {
  id: string;
  sport: string;
  label: string;
  category: string | null;
  slotDurationMinutes: number;
  /** Full rate matrix so the wizard can show it and pre-fill the
   *  anchor with the highest rate. Rupees per SLOT (30-min configs
   *  are normalised to per-hour by the caller). */
  rates: { dayType: string; timeType: string; pricePerSlot: number }[];
}

export async function getPassAdminData() {
  await requireAdmin(PERMISSION);

  const [configs, plans] = await Promise.all([
    db.courtConfig.findMany({
      where: { isActive: true },
      select: {
        id: true,
        sport: true,
        label: true,
        category: true,
        slotDurationMinutes: true,
        prices: {
          select: { dayType: true, timeType: true, pricePerSlot: true },
        },
      },
      orderBy: [{ sport: "asc" }, { label: "asc" }],
    }),
    db.passPlan.findMany({
      include: { _count: { select: { userPasses: true } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    }),
  ]);

  return {
    configs: configs.map(
      (c): PassConfigOption => ({
        id: c.id,
        sport: String(c.sport),
        label: c.label,
        category: c.category ? String(c.category) : null,
        slotDurationMinutes: c.slotDurationMinutes,
        rates: c.prices.map((p) => ({
          dayType: String(p.dayType),
          timeType: String(p.timeType),
          pricePerSlot: p.pricePerSlot,
        })),
      }),
    ),
    plans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      sport: String(p.sport),
      courtConfigId: p.courtConfigId,
      totalMinutes: p.totalMinutes,
      anchorPricePerHour: p.anchorPricePerHour,
      baseAmount: p.baseAmount,
      discountPercent: p.discountPercent,
      price: p.price,
      validityDays: p.validityDays,
      isActive: p.isActive,
      soldCount: p._count.userPasses,
    })),
  };
}

export async function createPassPlan(input: {
  courtConfigId: string;
  totalHours: number;
  anchorPricePerHour: number;
  discountPercent: number;
  validityDays: number;
  name?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin(PERMISSION);

  const { courtConfigId, totalHours, anchorPricePerHour, discountPercent, validityDays } = input;
  if (!Number.isFinite(totalHours) || totalHours <= 0 || totalHours > 200) {
    return { ok: false, error: "Hours must be between 1 and 200." };
  }
  // Whole or half hours only (half caters to 30-min bowling slots).
  if (Math.round(totalHours * 2) !== totalHours * 2) {
    return { ok: false, error: "Hours must be in 30-minute steps." };
  }
  if (!Number.isInteger(anchorPricePerHour) || anchorPricePerHour <= 0) {
    return { ok: false, error: "Anchor price must be a positive rupee amount." };
  }
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent >= 100) {
    return { ok: false, error: "Discount must be between 0 and 99%." };
  }
  if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 365) {
    return { ok: false, error: "Validity must be 1–365 days." };
  }

  const config = await db.courtConfig.findUnique({
    where: { id: courtConfigId },
    select: { id: true, sport: true, label: true, isActive: true },
  });
  if (!config || !config.isActive) {
    return { ok: false, error: "Court config not found or inactive." };
  }

  const baseAmount = Math.round(anchorPricePerHour * totalHours);
  const price = Math.round(baseAmount * (1 - discountPercent / 100));
  const name =
    input.name?.trim() ||
    `${config.label} — ${formatHours(totalHours)} Pass`;

  await db.passPlan.create({
    data: {
      name,
      sport: config.sport,
      courtConfigId,
      totalMinutes: Math.round(totalHours * 60),
      anchorPricePerHour,
      baseAmount,
      discountPercent,
      price,
      validityDays,
    },
  });
  revalidatePath("/admin/passes");
  return { ok: true };
}

export async function togglePassPlan(
  id: string,
  isActive: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin(PERMISSION);
  await db.passPlan.update({ where: { id }, data: { isActive } });
  revalidatePath("/admin/passes");
  return { ok: true };
}

export async function deletePassPlan(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin(PERMISSION);
  const sold = await db.userPass.count({ where: { planId: id } });
  if (sold > 0) {
    return {
      ok: false,
      error: `This plan has ${sold} sold pass(es) — deactivate it instead.`,
    };
  }
  await db.passPlan.delete({ where: { id } });
  revalidatePath("/admin/passes");
  return { ok: true };
}

function formatHours(h: number): string {
  return Number.isInteger(h) ? `${h} Hour` : `${h} Hr`;
}
