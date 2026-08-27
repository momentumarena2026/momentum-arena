"use server";

import { db } from "@/lib/db";
import { Prisma, type Sport } from "@prisma/client";
import { requireAdmin } from "@/lib/admin-auth";
import { revalidatePath } from "next/cache";
import { parseBands, bandKey, type Band } from "@/lib/pass-bands";
import { courtGroupKey, courtGroupLabel } from "@/lib/court-config";
import { parseStartDate, passLiveStatus } from "@/lib/passes";
import { normalizeIndianPhone } from "@/lib/phone";

/** Prisma Json write helper — Band[] lacks the index signature Prisma's
 *  InputJsonValue wants, so cast at the boundary. */
const bandsJson = (bands: Band[]) => bands as unknown as Prisma.InputJsonValue;

/**
 * Validate a band selection for a court and derive the anchor. Every
 * selected band must exist on the court AND share one per-slot price
 * (that price becomes the anchor). Returns the anchor + normalised bands
 * or an error string.
 */
async function resolveBandsAnchor(
  courtConfigId: string,
  rawBands: unknown,
): Promise<
  | {
      ok: true;
      config: { id: string; sport: Sport; label: string; slotDurationMinutes: number };
      bands: Band[];
      anchorPrice: number;
      anchorPricePerHour: number;
    }
  | { ok: false; error: string }
> {
  const config = await db.courtConfig.findUnique({
    where: { id: courtConfigId },
    select: {
      id: true,
      sport: true,
      label: true,
      isActive: true,
      slotDurationMinutes: true,
      prices: { select: { dayType: true, timeType: true, pricePerSlot: true } },
    },
  });
  if (!config || !config.isActive) {
    return { ok: false, error: "Court config not found or inactive." };
  }
  const bands = parseBands(rawBands);
  if (bands.length === 0) {
    return { ok: false, error: "Select at least one pricing band." };
  }
  const priceByKey = new Map(
    config.prices.map((p) => [`${p.dayType}-${p.timeType}`, p.pricePerSlot]),
  );
  const prices = bands.map((b) => priceByKey.get(bandKey(b)));
  if (prices.some((p) => p == null)) {
    return { ok: false, error: "A selected band has no configured price." };
  }
  const unique = new Set(prices);
  if (unique.size !== 1) {
    return { ok: false, error: "All selected bands must have the same price." };
  }
  const anchorPrice = prices[0] as number;
  const anchorPricePerHour = Math.round(
    (anchorPrice * 60) / config.slotDurationMinutes,
  );
  return {
    ok: true,
    config: {
      id: config.id,
      sport: config.sport,
      label: config.label,
      slotDurationMinutes: config.slotDurationMinutes,
    },
    bands,
    anchorPrice,
    anchorPricePerHour,
  };
}

/**
 * Monthly Passes — admin plan management (Phase 1 of the passes
 * module). A PassPlan sells N hours on one court config at a
 * discounted effective hourly rate, valid for validityDays from
 * purchase. Customer purchase + redemption land in later phases.
 */

const PERMISSION = "MANAGE_PASSES" as const;

/**
 * Every export here is a public server-action endpoint, so the
 * permission gate must run server-side on EVERY call with no
 * caller-supplied escape hatch. requireAdmin resolves the caller from
 * either the web cookie session or the mobile Bearer JWT, so the
 * mobile admin routes (which call these actions in-process) are
 * covered by the same gate.
 */
async function gate(): Promise<{ id: string }> {
  return requireAdmin(PERMISSION);
}

/** Storefront master switch — reads/writes ArenaSettings.passesEnabled. */
export async function getPassesEnabled(): Promise<boolean> {
  await gate();
  const settings = await db.arenaSettings.findFirst({
    select: { passesEnabled: true },
  });
  return settings?.passesEnabled ?? false;
}

export async function setPassesEnabled(enabled: boolean): Promise<{ ok: true }> {
  await gate();
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
  /** Shared-member cap for passes on this court group (0 = sharing off). */
  maxPassMembers: number;
  /** Full rate matrix so the wizard can show it and pre-fill the
   *  anchor with the highest rate. Rupees per SLOT (30-min configs
   *  are normalised to per-hour by the caller). */
  rates: { dayType: string; timeType: string; pricePerSlot: number }[];
}

export async function getPassAdminData() {
  await gate();

  const [configs, plans] = await Promise.all([
    db.courtConfig.findMany({
      where: { isActive: true },
      select: {
        id: true,
        sport: true,
        size: true,
        position: true,
        label: true,
        category: true,
        slotDurationMinutes: true,
        maxPassMembers: true,
        prices: {
          select: { dayType: true, timeType: true, pricePerSlot: true },
        },
      },
      orderBy: [{ sport: "asc" }, { size: "asc" }, { position: "asc" }],
    }),
    db.passPlan.findMany({
      include: { _count: { select: { userPasses: true } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    }),
  ]);

  // Per-court current price lookup, to flag plans whose band price has
  // since drifted off their anchor (pricing changed under them).
  const priceByCourtBand = new Map(
    configs.map((c) => [
      c.id,
      new Map(c.prices.map((p) => [`${p.dayType}-${p.timeType}`, p.pricePerSlot])),
    ]),
  );

  // Collapse interchangeable positions (both cricket half-courts, both
  // leather pitches) into ONE pickable option — a pass covers the whole
  // group. The first config in each group (LEFT / LP1, by the ordering
  // above) is the stored representative.
  const groupedConfigs: PassConfigOption[] = [];
  const seenGroups = new Set<string>();
  for (const c of configs) {
    const key = courtGroupKey({
      sport: String(c.sport),
      size: String(c.size),
      category: c.category ? String(c.category) : null,
    });
    if (seenGroups.has(key)) continue;
    seenGroups.add(key);
    groupedConfigs.push({
      id: c.id,
      sport: String(c.sport),
      label: courtGroupLabel({
        sport: String(c.sport),
        size: String(c.size),
        category: c.category ? String(c.category) : null,
        label: c.label,
      }),
      category: c.category ? String(c.category) : null,
      slotDurationMinutes: c.slotDurationMinutes,
      maxPassMembers: c.maxPassMembers,
      rates: c.prices.map((p) => ({
        dayType: String(p.dayType),
        timeType: String(p.timeType),
        pricePerSlot: p.pricePerSlot,
      })),
    });
  }

  return {
    configs: groupedConfigs,
    plans: plans.map((p) => {
      const bands = parseBands(p.bands);
      // Bands whose CURRENT court price still equals the anchor. A plan
      // with none is effectively unsellable (pricing changed) — surfaced
      // so the admin table can flag it. Legacy unrestricted (no bands +
      // no anchor) is always valid.
      const courtPrices = priceByCourtBand.get(p.courtConfigId);
      const validBands =
        p.anchorPrice == null
          ? bands
          : bands.filter(
              (b) => courtPrices?.get(bandKey(b)) === p.anchorPrice,
            );
      const pricingValid =
        bands.length === 0 || validBands.length > 0;
      return {
        id: p.id,
        name: p.name,
        sport: String(p.sport),
        courtConfigId: p.courtConfigId,
        totalMinutes: p.totalMinutes,
        anchorPricePerHour: p.anchorPricePerHour,
        anchorPrice: p.anchorPrice,
        bands,
        pricingValid,
        baseAmount: p.baseAmount,
        discountPercent: p.discountPercent,
        price: p.price,
        validityDays: p.validityDays,
        isActive: p.isActive,
        isCheapestHourAnchor: p.isCheapestHourAnchor,
        soldCount: p._count.userPasses,
      };
    }),
  };
}

export async function createPassPlan(input: {
  courtConfigId: string;
  totalHours: number;
  bands: Band[];
  discountPercent: number;
  validityDays: number;
  name?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await gate();

  const { courtConfigId, totalHours, discountPercent, validityDays } = input;
  if (!Number.isFinite(totalHours) || totalHours <= 0 || totalHours > 200) {
    return { ok: false, error: "Hours must be between 1 and 200." };
  }
  // Whole or half hours only (half caters to 30-min bowling slots).
  if (Math.round(totalHours * 2) !== totalHours * 2) {
    return { ok: false, error: "Hours must be in 30-minute steps." };
  }
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent >= 100) {
    return { ok: false, error: "Discount must be between 0 and 99%." };
  }
  if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 365) {
    return { ok: false, error: "Validity must be 1–365 days." };
  }

  const resolved = await resolveBandsAnchor(courtConfigId, input.bands);
  if (!resolved.ok) return resolved;
  const { config, bands, anchorPrice, anchorPricePerHour } = resolved;

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
      anchorPrice,
      bands: bandsJson(bands),
      baseAmount,
      discountPercent,
      price,
      validityDays,
    },
  });
  revalidatePath("/admin/passes");
  revalidatePath("/passes");
  return { ok: true };
}

/**
 * Edit a pass plan. Recomputes baseAmount + price from the new hours /
 * anchor / discount. The court + sport are fixed at creation (change
 * those by making a new plan) — everything else is editable. Sold
 * passes are snapshots and are NOT affected; edits only change what
 * future buyers get.
 */
export async function updatePassPlan(
  id: string,
  input: {
    totalHours: number;
    bands: Band[];
    discountPercent: number;
    validityDays: number;
    name?: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  await gate();

  const { totalHours, discountPercent, validityDays } = input;
  if (!Number.isFinite(totalHours) || totalHours <= 0 || totalHours > 200) {
    return { ok: false, error: "Hours must be between 1 and 200." };
  }
  if (Math.round(totalHours * 2) !== totalHours * 2) {
    return { ok: false, error: "Hours must be in 30-minute steps." };
  }
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent >= 100) {
    return { ok: false, error: "Discount must be between 0 and 99%." };
  }
  if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 365) {
    return { ok: false, error: "Validity must be 1–365 days." };
  }

  const plan = await db.passPlan.findUnique({
    where: { id },
    select: { id: true, courtConfigId: true },
  });
  if (!plan) return { ok: false, error: "Plan not found." };

  const resolved = await resolveBandsAnchor(plan.courtConfigId, input.bands);
  if (!resolved.ok) return resolved;
  const { config, bands, anchorPrice, anchorPricePerHour } = resolved;

  const baseAmount = Math.round(anchorPricePerHour * totalHours);
  const price = Math.round(baseAmount * (1 - discountPercent / 100));
  const name =
    input.name?.trim() ||
    `${config.label} — ${formatHours(totalHours)} Pass`;

  await db.passPlan.update({
    where: { id },
    data: {
      name,
      totalMinutes: Math.round(totalHours * 60),
      anchorPricePerHour,
      anchorPrice,
      bands: bandsJson(bands),
      baseAmount,
      discountPercent,
      price,
      validityDays,
    },
  });
  revalidatePath("/admin/passes");
  revalidatePath("/passes");
  return { ok: true };
}

export async function togglePassPlan(
  id: string,
  isActive: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await gate();
  await db.passPlan.update({ where: { id }, data: { isActive } });
  revalidatePath("/admin/passes");
  return { ok: true };
}

/**
 * Tick/untick a plan as the cheapest pass for its court type. Exactly
 * ONE anchor per interchangeable court group (cricket full field,
 * cricket half court, bowling machine, football, pickleball, …):
 * ticking a plan un-ticks the group's previous holder. Drives the
 * slot-selection "Save More with Arena Passes" banner and its
 * "from ₹X/hour" price.
 */
export async function setPassCheapestHour(
  id: string,
  on: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await gate();
  const plan = await db.passPlan.findUnique({
    where: { id },
    select: {
      id: true,
      isActive: true,
      courtConfig: { select: { sport: true, size: true, category: true } },
    },
  });
  if (!plan) return { ok: false, error: "Plan not found" };
  if (on && !plan.isActive) {
    return { ok: false, error: "Activate the plan before making it an anchor" };
  }

  const groupConfigs = await db.courtConfig.findMany({
    where: {
      sport: plan.courtConfig.sport,
      size: plan.courtConfig.size,
      category: plan.courtConfig.category,
    },
    select: { id: true },
  });
  const groupIds = groupConfigs.map((c) => c.id);

  await db.$transaction(async (tx) => {
    if (on) {
      await tx.passPlan.updateMany({
        where: {
          courtConfigId: { in: groupIds },
          isCheapestHourAnchor: true,
          id: { not: id },
        },
        data: { isCheapestHourAnchor: false },
      });
    }
    await tx.passPlan.update({
      where: { id },
      data: { isCheapestHourAnchor: on },
    });
  });
  revalidatePath("/admin/passes");
  return { ok: true };
}

export async function deletePassPlan(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await gate();
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
  startDate?: string;
}): Promise<{ ok: true; userPassId: string } | { ok: false; error: string }> {
  const admin = await gate();

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

  const startsAt = parseStartDate(input.startDate);
  const expiresAt = new Date(
    startsAt.getTime() + plan.validityDays * 24 * 60 * 60 * 1000,
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
      startsAt,
      expiresAt,
      bands: bandsJson(parseBands(plan.bands)),
      anchorPrice: plan.anchorPrice,
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
  /** Pricing bands this gift redeems on. Empty = all hours (a gift needn't
   *  respect same-price rules — it's free). */
  bands?: Band[];
  name?: string;
  value?: number;
  note?: string;
  startDate?: string;
}): Promise<{ ok: true; userPassId: string } | { ok: false; error: string }> {
  const admin = await gate();

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
  const startsAt = parseStartDate(input.startDate);
  const expiresAt = new Date(
    startsAt.getTime() + validityDays * 24 * 60 * 60 * 1000,
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
      startsAt,
      expiresAt,
      bands: bandsJson(parseBands(input.bands ?? [])),
      anchorPrice: null,
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
  await gate();
  const passes = await db.userPass.findMany({
    include: {
      user: { select: { name: true, phone: true } },
      redemptions: { select: { minutes: true, restoredAt: true } },
      _count: { select: { members: true } },
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
    status: passLiveStatus(p),
    method: passMethodLabel(p),
    purchasedAt: p.purchasedAt.toISOString(),
    startsAt: p.startsAt.toISOString(),
    expiresAt: p.expiresAt.toISOString(),
    redemptionCount: p.redemptions.filter((r) => !r.restoredAt).length,
    memberCount: p._count.members,
  }));
}

export async function extendPassValidity(
  id: string,
  extraDays: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await gate();
  if (!Number.isInteger(extraDays) || extraDays < 1 || extraDays > 365) {
    return { ok: false, error: "Days must be 1–365." };
  }
  const pass = await db.userPass.findUnique({ where: { id } });
  if (!pass) return { ok: false, error: "Pass not found." };
  // Cancellation is terminal — a cancelled pass can't be revived.
  if (pass.status === "CANCELLED") {
    return { ok: false, error: "This pass is cancelled — no further changes." };
  }
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
  await gate();
  if (!Number.isInteger(deltaMinutes) || deltaMinutes === 0) {
    return { ok: false, error: "Delta must be a non-zero minute count." };
  }
  const pass = await db.userPass.findUnique({ where: { id } });
  if (!pass) return { ok: false, error: "Pass not found." };
  // Cancellation is terminal — a cancelled pass can't be revived.
  if (pass.status === "CANCELLED") {
    return { ok: false, error: "This pass is cancelled — no further changes." };
  }
  if (pass.remainingMinutes + deltaMinutes < 0) {
    return { ok: false, error: "Balance can't go negative." };
  }
  // Atomic increment/decrement (never an absolute write from a stale
  // read): a redemption or extend landing between the read above and
  // this write must not be undone by the admin's adjustment. The `gte`
  // guard re-checks the floor at write time.
  const applied = await db.userPass.updateMany({
    where: {
      id,
      status: { not: "CANCELLED" },
      ...(deltaMinutes < 0
        ? { remainingMinutes: { gte: -deltaMinutes } }
        : {}),
    },
    data: { remainingMinutes: { increment: deltaMinutes } },
  });
  if (applied.count === 0) {
    return {
      ok: false,
      error: "Pass balance changed — reload and try again.",
    };
  }
  // Status follows the resulting balance, same as debitPass.
  if (deltaMinutes > 0) {
    await db.userPass.updateMany({
      where: { id, remainingMinutes: { gt: 0 }, status: "EXHAUSTED" },
      data: { status: "ACTIVE" },
    });
  } else {
    await db.userPass.updateMany({
      where: { id, remainingMinutes: { lte: 0 }, status: "ACTIVE" },
      data: { status: "EXHAUSTED" },
    });
  }
  revalidatePath("/admin/passes");
  return { ok: true };
}

/** Widest window an admin may move a start date into, either direction. */
const START_EDIT_WINDOW_DAYS = 365;

/**
 * Move a sold pass's start date.
 *
 * Corrects the case the other actions can't: a pass issued against the
 * wrong activation day. Extend only pushes the expiry out, Adjust only
 * moves the balance — neither can say "this one actually starts on the
 * 30th".
 *
 * **The expiry travels with it.** `expiresAt` shifts by the same delta
 * rather than being recomputed as `start + validityDays`, so the customer
 * keeps exactly the window they bought AND any extra days an admin already
 * granted with Extend. Recomputing would silently revoke that extension.
 *
 * Deliberately NOT reusing lib/passes `parseStartDate`: that clamps to
 * "today or later", which is right when a customer schedules a purchase and
 * wrong here. An admin fixing a data-entry error needs to move a start
 * backwards, and a silent clamp would snap their chosen date to today with
 * no explanation. This parses the same way (IST midnight, because validity
 * is judged against a booking's calendar date) but validates instead of
 * clamping.
 */
export async function setPassStartDate(
  id: string,
  startDate: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await gate();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate ?? "")) {
    return { ok: false, error: "Pick a valid date." };
  }
  const newStart = new Date(`${startDate}T00:00:00+05:30`);
  if (Number.isNaN(newStart.getTime())) {
    return { ok: false, error: "Pick a valid date." };
  }

  const pass = await db.userPass.findUnique({
    where: { id },
    include: {
      redemptions: {
        where: { restoredAt: null },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  if (!pass) return { ok: false, error: "Pass not found." };
  // Cancellation is terminal — same rule as Extend and Adjust.
  if (pass.status === "CANCELLED") {
    return { ok: false, error: "This pass is cancelled — no further changes." };
  }

  const now = Date.now();
  const limit = START_EDIT_WINDOW_DAYS * 86_400_000;
  if (Math.abs(newStart.getTime() - now) > limit) {
    return {
      ok: false,
      error: `Start date must be within ${START_EDIT_WINDOW_DAYS} days of today.`,
    };
  }

  const delta = newStart.getTime() - pass.startsAt.getTime();
  if (delta === 0) return { ok: true };
  const newExpires = new Date(pass.expiresAt.getTime() + delta);

  // A pass cannot have been redeemed before it started. Moving the start
  // past an existing redemption would leave the books claiming hours were
  // drawn from a pass that had not yet begun.
  const firstRedemption = pass.redemptions[0]?.createdAt;
  if (firstRedemption && newStart.getTime() > firstRedemption.getTime()) {
    return {
      ok: false,
      error: `This pass was already redeemed on ${firstRedemption.toLocaleDateString(
        "en-IN",
        { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" },
      )}. Pick a start on or before that date.`,
    };
  }

  await db.userPass.update({
    where: { id },
    data: {
      startsAt: newStart,
      expiresAt: newExpires,
      // Re-arm a pass whose stored status went EXPIRED but whose new window
      // covers today. Mirrors extendPassValidity. Live status (UPCOMING /
      // EXPIRED) is derived by passLiveStatus, so nothing else needs setting.
      ...(pass.status === "EXPIRED" &&
      newExpires.getTime() > now &&
      pass.remainingMinutes > 0
        ? { status: "ACTIVE" as const }
        : {}),
    },
  });
  revalidatePath("/admin/passes");
  return { ok: true };
}

export async function cancelUserPass(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await gate();
  await db.userPass.update({ where: { id }, data: { status: "CANCELLED" } });
  revalidatePath("/admin/passes");
  return { ok: true };
}

// ─── Pass sharing (members) ─────────────────────────────────────────

/**
 * Set how many additional members a pass on this court group may be
 * shared with. Writes the same value to EVERY config in the group
 * (e.g. both cricket half-courts) so a pass stored on either matches.
 */
export async function setPassSharingLimit(
  courtConfigId: string,
  max: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await gate();
  if (!Number.isInteger(max) || max < 0 || max > 30) {
    return { ok: false, error: "Members must be 0–30." };
  }
  const config = await db.courtConfig.findUnique({
    where: { id: courtConfigId },
    select: { sport: true, size: true, category: true },
  });
  if (!config) return { ok: false, error: "Court not found." };
  await db.courtConfig.updateMany({
    where: {
      sport: config.sport,
      size: config.size,
      category: config.category,
    },
    data: { maxPassMembers: max },
  });
  revalidatePath("/admin/passes");
  return { ok: true };
}

/** Members of a pass + the court's cap, for the admin Members modal. */
export async function adminGetPassMembers(passId: string) {
  await gate();
  const pass = await db.userPass.findUnique({
    where: { id: passId },
    select: {
      name: true,
      user: { select: { name: true, phone: true } },
      courtConfig: { select: { maxPassMembers: true } },
      members: {
        orderBy: { addedAt: "asc" },
        include: { user: { select: { id: true, name: true, phone: true } } },
      },
    },
  });
  if (!pass) return null;
  return {
    passName: pass.name,
    owner: { name: pass.user.name, phone: pass.user.phone },
    maxMembers: pass.courtConfig.maxPassMembers,
    members: pass.members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      phone: m.user.phone,
      addedAt: m.addedAt.toISOString(),
    })),
  };
}

/** Admin adds a member to any pass by registered phone (same rules as
 *  the owner flow; notRegistered flags an un-signed-up number). */
export async function adminAddPassMember(
  passId: string,
  phoneRaw: string,
): Promise<
  | { ok: true }
  | { ok: false; error: string; notRegistered?: boolean; phone?: string }
> {
  const admin = await gate();

  const pass = await db.userPass.findUnique({
    where: { id: passId },
    include: {
      courtConfig: { select: { maxPassMembers: true } },
      _count: { select: { members: true } },
    },
  });
  if (!pass) return { ok: false, error: "Pass not found." };
  if (pass.status === "CANCELLED") {
    return { ok: false, error: "This pass is cancelled." };
  }
  const max = pass.courtConfig.maxPassMembers;
  if (max <= 0) {
    return { ok: false, error: "Sharing isn't enabled for this court — set a member limit first." };
  }
  if (pass._count.members >= max) {
    return { ok: false, error: `Member limit reached (${max} max).` };
  }

  const phone = normalizeIndianPhone(phoneRaw);
  if (phone.length !== 12 || !phone.startsWith("91")) {
    return { ok: false, error: "Enter a valid 10-digit Indian mobile number." };
  }
  const user = await db.user.findUnique({
    where: { phone },
    select: { id: true },
  });
  if (!user) {
    return {
      ok: false,
      error: "This number isn't registered yet.",
      notRegistered: true,
      phone,
    };
  }
  if (user.id === pass.userId) {
    return { ok: false, error: "That's the pass owner — always included." };
  }
  try {
    await db.passMember.create({
      data: { userPassId: passId, userId: user.id, addedBy: admin.id },
    });
  } catch {
    return { ok: false, error: "Already a member of this pass." };
  }
  revalidatePath("/admin/passes");
  return { ok: true };
}

/** Admin removes a member from any pass. */
export async function adminRemovePassMember(
  passId: string,
  memberUserId: string,
): Promise<{ ok: true }> {
  await gate();
  await db.passMember
    .delete({
      where: {
        userPassId_userId: { userPassId: passId, userId: memberUserId },
      },
    })
    .catch(() => {});
  revalidatePath("/admin/passes");
  return { ok: true };
}
