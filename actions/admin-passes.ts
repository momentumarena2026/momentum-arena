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

/** Storefront master switch — reads/writes ArenaSettings.passesEnabled. */
export async function getPassesEnabled(): Promise<boolean> {
  await requireAdmin(PERMISSION);
  const settings = await db.arenaSettings.findFirst({
    select: { passesEnabled: true },
  });
  return settings?.passesEnabled ?? false;
}

export async function setPassesEnabled(
  enabled: boolean,
): Promise<{ ok: true }> {
  await requireAdmin(PERMISSION);
  const existing = await db.arenaSettings.findFirst({ select: { id: true } });
  if (existing) {
    await db.arenaSettings.update({
      where: { id: existing.id },
      data: { passesEnabled: enabled },
    });
  } else {
    await db.arenaSettings.create({ data: { passesEnabled: enabled } });
  }
  revalidatePath("/admin/passes");
  revalidatePath("/passes");
  return { ok: true };
}

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

// ─── Issue a pass at the venue (offline sale) ───────────────────────

/**
 * Admin issues a pass directly to a customer — a walk-in who bought at
 * the venue and paid by cash or static QR (or a free/comp pass). No
 * gateway involved: we snapshot the plan onto a new UserPass exactly
 * like an online purchase, but stamp the offline payment method, the
 * issuing admin, and an optional reference (static-QR UTR / note).
 *
 * amountCollected lets staff record what was actually taken (walk-in
 * discounts, rounding); it defaults to the plan price and is forced to
 * 0 for a FREE comp pass.
 */
export async function issuePassToUser(input: {
  planId: string;
  userId: string;
  paymentMethod: "CASH" | "UPI_QR" | "FREE";
  amountCollected?: number;
  offlineRef?: string;
}): Promise<{ ok: true; userPassId: string } | { ok: false; error: string }> {
  const admin = await requireAdmin(PERMISSION);

  const { planId, userId, paymentMethod } = input;
  if (!["CASH", "UPI_QR", "FREE"].includes(paymentMethod)) {
    return { ok: false, error: "Invalid payment method." };
  }

  const [plan, user] = await Promise.all([
    db.passPlan.findUnique({ where: { id: planId } }),
    db.user.findUnique({ where: { id: userId }, select: { id: true } }),
  ]);
  if (!plan) return { ok: false, error: "Plan not found." };
  if (!user) return { ok: false, error: "Customer not found." };

  // Price actually collected: FREE ⇒ 0, else the override (if a valid
  // non-negative rupee amount was given) or the plan price.
  let price = plan.price;
  if (paymentMethod === "FREE") {
    price = 0;
  } else if (input.amountCollected != null) {
    if (!Number.isInteger(input.amountCollected) || input.amountCollected < 0) {
      return { ok: false, error: "Amount collected must be a non-negative whole number." };
    }
    price = input.amountCollected;
  }

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + plan.validityDays * 24 * 60 * 60 * 1000,
  );

  const created = await db.userPass.create({
    data: {
      planId: plan.id,
      userId,
      name: plan.name,
      sport: plan.sport,
      courtConfigId: plan.courtConfigId,
      totalMinutes: plan.totalMinutes,
      price,
      validityDays: plan.validityDays,
      remainingMinutes: plan.totalMinutes,
      expiresAt,
      paymentMethod,
      issuedByAdminId: admin.id,
      offlineRef: input.offlineRef?.trim() || null,
    },
    select: { id: true },
  });

  revalidatePath("/admin/passes");
  return { ok: true, userPassId: created.id };
}

/**
 * Gift / assign a bespoke pass to one specific customer. Unlike a
 * plan-backed sale this creates NO public PassPlan — the pass exists
 * only on the recipient's account (planId null), so it never shows on
 * the customer storefront. Used for occasion gifts. Free by default;
 * an optional value can be recorded. Redeemable at checkout on the
 * chosen court exactly like a purchased pass.
 */
export async function giftCustomPass(input: {
  userId: string;
  courtConfigId: string;
  totalHours: number;
  validityDays: number;
  name?: string;
  value?: number;
  note?: string;
}): Promise<{ ok: true; userPassId: string } | { ok: false; error: string }> {
  const admin = await requireAdmin(PERMISSION);

  const { userId, courtConfigId, totalHours, validityDays } = input;
  if (!Number.isFinite(totalHours) || totalHours <= 0 || totalHours > 200) {
    return { ok: false, error: "Hours must be between 1 and 200." };
  }
  if (Math.round(totalHours * 2) !== totalHours * 2) {
    return { ok: false, error: "Hours must be in 30-minute steps." };
  }
  if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 365) {
    return { ok: false, error: "Validity must be 1–365 days." };
  }
  const value = input.value ?? 0;
  if (!Number.isInteger(value) || value < 0) {
    return { ok: false, error: "Value must be a non-negative whole number." };
  }

  const [config, user] = await Promise.all([
    db.courtConfig.findUnique({
      where: { id: courtConfigId },
      select: { id: true, sport: true, label: true, isActive: true },
    }),
    db.user.findUnique({ where: { id: userId }, select: { id: true } }),
  ]);
  if (!config || !config.isActive) {
    return { ok: false, error: "Court config not found or inactive." };
  }
  if (!user) return { ok: false, error: "Customer not found." };

  const totalMinutes = Math.round(totalHours * 60);
  const name =
    input.name?.trim() || `${config.label} — ${formatHours(totalHours)} Gift Pass`;
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + validityDays * 24 * 60 * 60 * 1000,
  );

  const created = await db.userPass.create({
    data: {
      planId: null, // bespoke — no public plan behind it
      userId,
      name,
      sport: config.sport,
      courtConfigId,
      totalMinutes,
      price: value,
      validityDays,
      remainingMinutes: totalMinutes,
      expiresAt,
      paymentMethod: "FREE",
      issuedByAdminId: admin.id,
      offlineRef: input.note?.trim() || null,
    },
    select: { id: true },
  });

  revalidatePath("/admin/passes");
  return { ok: true, userPassId: created.id };
}

/** Human label for how a pass was paid — a bespoke gift (no plan)
 *  reads as "Gift"; otherwise the offline method if stamped, else
 *  inferred from the gateway refs. */
function passMethodLabel(p: {
  planId: string | null;
  paymentMethod: string | null;
  razorpayOrderId: string | null;
  phonePeMerchantTxnId: string | null;
}): string {
  if (!p.planId) return "Gift";
  switch (p.paymentMethod) {
    case "CASH":
      return "Cash";
    case "UPI_QR":
      return "Static QR";
    case "FREE":
      return "Free";
    case "RAZORPAY":
      return "Razorpay";
    case "PHONEPE":
      return "UPI (DQR)";
  }
  if (p.phonePeMerchantTxnId) return "UPI (DQR)";
  if (p.razorpayOrderId) return "Razorpay";
  return "Online";
}

// ─── Sold passes (Phase 4) ──────────────────────────────────────────

export async function getSoldPasses() {
  await requireAdmin(PERMISSION);
  const passes = await db.userPass.findMany({
    include: {
      user: { select: { name: true, phone: true } },
      redemptions: { select: { minutes: true, restoredAt: true } },
    },
    orderBy: { purchasedAt: "desc" },
    take: 200,
  });
  return passes.map((p) => ({
    id: p.id,
    name: p.name,
    customer: p.user.name ?? "—",
    phone: p.user.phone ?? "—",
    totalMinutes: p.totalMinutes,
    remainingMinutes: p.remainingMinutes,
    price: p.price,
    status: p.status,
    method: passMethodLabel(p),
    purchasedAt: p.purchasedAt.toISOString(),
    expiresAt: p.expiresAt.toISOString(),
    redemptionCount: p.redemptions.filter((r) => !r.restoredAt).length,
  }));
}

export async function extendPassValidity(
  id: string,
  extraDays: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin(PERMISSION);
  if (!Number.isInteger(extraDays) || extraDays < 1 || extraDays > 365) {
    return { ok: false, error: "Days must be 1–365." };
  }
  const pass = await db.userPass.findUnique({ where: { id } });
  if (!pass) return { ok: false, error: "Pass not found." };
  await db.userPass.update({
    where: { id },
    data: {
      expiresAt: new Date(
        pass.expiresAt.getTime() + extraDays * 24 * 60 * 60 * 1000,
      ),
      // Re-arm an expired-but-unspent pass.
      ...(pass.status === "EXPIRED" ? { status: "ACTIVE" } : {}),
    },
  });
  revalidatePath("/admin/passes");
  return { ok: true };
}

export async function adjustPassMinutes(
  id: string,
  deltaMinutes: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin(PERMISSION);
  if (!Number.isInteger(deltaMinutes) || deltaMinutes === 0) {
    return { ok: false, error: "Delta must be a non-zero minute count." };
  }
  const pass = await db.userPass.findUnique({ where: { id } });
  if (!pass) return { ok: false, error: "Pass not found." };
  const next = pass.remainingMinutes + deltaMinutes;
  if (next < 0) return { ok: false, error: "Balance can't go negative." };
  await db.userPass.update({
    where: { id },
    data: {
      remainingMinutes: next,
      status: next > 0 && pass.status === "EXHAUSTED" ? "ACTIVE" : pass.status,
    },
  });
  revalidatePath("/admin/passes");
  return { ok: true };
}

export async function cancelUserPass(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin(PERMISSION);
  await db.userPass.update({ where: { id }, data: { status: "CANCELLED" } });
  revalidatePath("/admin/passes");
  return { ok: true };
}
