"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  campBlockConflicts,
  newlyBlockedWindows,
  releaseCampBlocks,
  syncCampBlocks,
  type CampSchedule,
} from "@/lib/camp-blocks";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { registerForCamp, campSeatsTaken } from "@/lib/camps";

/**
 * Admin side of the camps module: configure a camp, work its roster, and
 * register a walk-in at the desk.
 *
 * Everything here is gated on MANAGE_CAMPS. Money rules live in
 * lib/camps.ts so the desk and the customer path can't drift apart.
 */
function gate() {
  return requireAdmin("MANAGE_CAMPS");
}

// ── Module master switch (mirrors tournaments + passes) ──────────────
// Without this the flag was DB-only, so the whole customer-facing camps
// module 404'd with no way to turn it on from the admin.
export async function getCampsEnabled(): Promise<boolean> {
  await gate();
  const settings = await db.arenaSettings.findFirst({
    select: { campsEnabled: true },
  });
  return settings?.campsEnabled ?? false;
}

export async function setCampsEnabled(enabled: boolean): Promise<{ ok: true }> {
  await gate();
  const existing = await db.arenaSettings.findFirst({ select: { id: true } });
  if (existing) {
    await db.arenaSettings.update({
      where: { id: existing.id },
      data: { campsEnabled: enabled },
    });
  } else {
    await db.arenaSettings.create({ data: { campsEnabled: enabled } });
  }
  revalidatePath("/admin/camps");
  revalidatePath("/camps");
  return { ok: true };
}

const campSchema = z.object({
  name: z.string().min(1).max(80),
  sport: z.enum(["CRICKET", "FOOTBALL", "PICKLEBALL"]),
  description: z.string().optional(),
  rules: z.string().optional(),
  bannerImageUrl: z.string().optional(),
  startDate: z.string(),
  endDate: z.string(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)),
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(1).max(24),
  regOpenAt: z.string().optional(),
  regCloseAt: z.string().optional(),
  ageMin: z.number().int().nullable().optional(),
  ageMax: z.number().int().nullable().optional(),
  coachName: z.string().optional(),
  venueNote: z.string().optional(),
  capacity: z.number().int().min(1),
  fee: z.number().int().min(0),
  // One-time joining fee. Zero is meaningful and common — most camps
  // will not charge one — so it is optional and defaults to 0 rather
  // than being required.
  registrationFee: z.number().int().min(0).default(0),
  feeMode: z.enum(["FULL", "ADVANCE", "FREE"]),
  advancePct: z.number().int().min(1).max(99),
  allowCoupons: z.boolean(),
  allowRewardPoints: z.boolean(),
  waitlistEnabled: z.boolean(),
  /// Hold the courts for every session this camp's schedule describes.
  blockSlots: z.boolean().default(false),
});

export type CampInput = z.infer<typeof campSchema>;

/** Admin datetime-local values are venue wall-clock: pin them to IST or a
 *  UTC server silently shifts 6:00 PM to 11:30 PM. Same helper the
 *  tournament wizard uses. */
function toDate(s: string | undefined): Date | null {
  if (!s) return null;
  const bare = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(s);
  if (!bare) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  const withTime = s.includes("T") ? s : `${s}T00:00`;
  const d = new Date(`${withTime}${withTime.length === 16 ? ":00" : ""}+05:30`);
  return isNaN(d.getTime()) ? null : d;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export async function listCamps() {
  await gate();
  const camps = await db.camp.findMany({
    orderBy: [{ startDate: "desc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      sport: true,
      status: true,
      startDate: true,
      endDate: true,
      capacity: true,
      fee: true,
      registrationFee: true,
      blockSlots: true,
      _count: {
        select: {
          registrations: {
            where: {
              status: { in: ["CONFIRMED", "PENDING_PAYMENT"] },
              archivedAt: null,
            },
          },
        },
      },
    },
  });
  return camps;
}

export async function getCampAdmin(id: string) {
  await gate();
  return db.camp.findUnique({
    where: { id },
    include: {
      registrations: {
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export async function saveCamp(
  input: CampInput & {
    id?: string;
    /** Set once the admin has seen and accepted the blocking warning. */
    confirmBlocking?: boolean;
  },
): Promise<{
  success: boolean;
  error?: string;
  id?: string;
  /**
   * The save did not happen and is not wrong — it is waiting on a human.
   * Distinct from `error` so the UI can offer "go ahead" rather than
   * just reporting a failure the admin cannot act on.
   */
  needsConfirm?: boolean;
  confirmTitle?: string;
  reasons?: string[];
}> {
  const admin = await gate();
  const parsed = campSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Invalid input" };
  }
  const d = parsed.data;

  if (d.endHour <= d.startHour) {
    return { success: false, error: "End time must be after the start time" };
  }
  if (d.daysOfWeek.length === 0) {
    return { success: false, error: "Pick at least one session day" };
  }
  const start = toDate(d.startDate);
  const end = toDate(d.endDate);
  if (!start || !end) return { success: false, error: "Invalid dates" };
  if (end < start) {
    return { success: false, error: "The camp can't end before it starts" };
  }

  const data = {
    name: d.name.trim(),
    sport: d.sport,
    description: d.description?.trim() || null,
    rules: d.rules?.trim() || null,
    bannerImageUrl: d.bannerImageUrl?.trim() || null,
    startDate: start,
    endDate: end,
    daysOfWeek: d.daysOfWeek,
    startHour: d.startHour,
    endHour: d.endHour,
    regOpenAt: toDate(d.regOpenAt),
    regCloseAt: toDate(d.regCloseAt),
    ageMin: d.ageMin ?? null,
    ageMax: d.ageMax ?? null,
    coachName: d.coachName?.trim() || null,
    venueNote: d.venueNote?.trim() || null,
    capacity: d.capacity,
    fee: d.fee,
    registrationFee: d.registrationFee,
    feeMode: d.feeMode,
    advancePct: d.advancePct,
    allowCoupons: d.allowCoupons,
    allowRewardPoints: d.allowRewardPoints,
    waitlistEnabled: d.waitlistEnabled,
    blockSlots: d.blockSlots,
  };

  if (input.id) {
    // Shrinking capacity below the seats already sold would silently
    // oversell the camp — refuse instead of letting it happen quietly.
    const taken = await campSeatsTaken(input.id);
    if (d.capacity < taken) {
      return {
        success: false,
        error: `${taken} seats are already taken — capacity can't go below that.`,
      };
    }

    const before = await db.camp.findUnique({
      where: { id: input.id },
      select: {
        id: true, name: true, sport: true, startDate: true, endDate: true,
        daysOfWeek: true, startHour: true, endHour: true, blockSlots: true,
      },
    });
    if (!before) return { success: false, error: "Camp not found" };

    const after: CampSchedule = {
      id: input.id,
      name: data.name,
      sport: data.sport,
      startDate: start,
      endDate: end,
      daysOfWeek: data.daysOfWeek,
      startHour: data.startHour,
      endHour: data.endHour,
    };

    // ── Ask before withdrawing inventory ──────────────────────────
    //
    // Moving an end date is a small edit to a form and a large change to
    // the calendar: extending a camp by three months takes three months
    // of evenings off sale, and only if this toggle happens to be on.
    // The person making that edit is thinking about the camp, not about
    // the booking grid, so they are told the number and asked — once —
    // rather than finding out from a customer.
    if (data.blockSlots && !input.confirmBlocking) {
      const reasons: string[] = [];
      const added = before.blockSlots
        ? newlyBlockedWindows({ ...before, name: before.name }, after)
        : (await campBlockConflicts(after)).windows;

      if (!before.blockSlots && added > 0) {
        reasons.push(`Blocking is being turned on — ${added} session hours will be held.`);
      } else if (added > 0) {
        reasons.push(`This change blocks ${added} more session hours than before.`);
      }

      // And what is already there. Another event on the same window is a
      // clash somebody must resolve; a booking already sold is a customer
      // who has to be rung, because a block hides a slot but cannot
      // un-sell it.
      const clash = await campBlockConflicts(after);
      for (const c of clash.blocks) {
        reasons.push(`${c.date} ${c.hour}:00 is already held by ${c.label}.`);
      }
      for (const b of clash.bookings) {
        reasons.push(`${b.date} ${b.hour}:00 is already booked on ${b.label}.`);
      }

      if (reasons.length > 0) {
        return {
          success: false,
          needsConfirm: true,
          confirmTitle: "This will hold court time",
          reasons,
          error: reasons[0],
        };
      }
    }

    await db.camp.update({ where: { id: input.id }, data });

    // Recompute rather than patch: the schedule is small, and keeping a
    // second description of which hours are held is how a blocked Tuesday
    // outlives a camp that stopped meeting on Tuesdays.
    if (data.blockSlots) {
      await syncCampBlocks(after, admin.email ?? "admin");
    } else if (before.blockSlots) {
      await releaseCampBlocks(input.id);
    }

    revalidatePath("/admin/camps");
    revalidatePath(`/admin/camps/${input.id}`);
    revalidatePath("/admin/bookings/calendar");
    return { success: true, id: input.id };
  }

  // New camp: unique slug from the name.
  const base = slugify(d.name) || "camp";
  let slug = base;
  for (let i = 2; await db.camp.findUnique({ where: { slug }, select: { id: true } }); i++) {
    slug = `${base}-${i}`;
  }
  const created = await db.camp.create({
    data: { ...data, slug, createdBy: admin.id },
    select: { id: true },
  });

  // A new camp created with blocking already on holds its courts
  // immediately. No confirmation here: nothing existed a moment ago, so
  // there is no change to warn about — the admin is describing the camp,
  // not altering one.
  if (data.blockSlots) {
    await syncCampBlocks(
      {
        id: created.id,
        name: data.name,
        sport: data.sport,
        startDate: start,
        endDate: end,
        daysOfWeek: data.daysOfWeek,
        startHour: data.startHour,
        endHour: data.endHour,
      },
      admin.email ?? "admin",
    );
    revalidatePath("/admin/bookings/calendar");
  }

  revalidatePath("/admin/camps");
  return { success: true, id: created.id };
}

/**
 * Cancelling a camp gives the courts back.
 *
 * A cancelled camp holding evenings nobody will use is inventory lost to
 * an event that is not happening, and the block outlives every screen
 * that would remind anyone it exists.
 */
export async function setCampStatus(
  campId: string,
  status: "DRAFT" | "REGISTRATIONS_OPEN" | "REGISTRATIONS_CLOSED" | "ONGOING" | "COMPLETED" | "CANCELLED",
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const camp = await db.camp.findUnique({
    where: { id: campId },
    select: { id: true },
  });
  if (!camp) return { success: false, error: "Camp not found" };
  await db.camp.update({ where: { id: campId }, data: { status } });

  // A cancelled camp must not keep holding evenings nobody will use. The
  // block would outlive every screen that would remind anyone it exists.
  if (status === "CANCELLED") {
    await releaseCampBlocks(campId);
    revalidatePath("/admin/bookings/calendar");
  }

  revalidatePath("/admin/camps");
  revalidatePath(`/admin/camps/${campId}`);
  return { success: true };
}

/** Register a walk-in at the desk — cash or QR taken in person. */
export async function adminRegisterForCamp(input: {
  campId: string;
  participantName: string;
  participantAge?: number | null;
  guardianName?: string | null;
  phone: string;
  email?: string | null;
  notes?: string | null;
  paidAmount: number;
  method: string;
}): Promise<{ success: boolean; error?: string }> {
  await gate();
  const res = await registerForCamp({
    campId: input.campId,
    participantName: input.participantName,
    participantAge: input.participantAge ?? null,
    guardianName: input.guardianName ?? null,
    phone: input.phone,
    email: input.email ?? null,
    notes: input.notes ?? null,
    offline: { paidAmount: input.paidAmount, method: input.method },
  });
  if (!res.ok) return { success: false, error: res.error };
  revalidatePath(`/admin/camps/${input.campId}`);
  return { success: true };
}

export async function setCampRegistrationStatus(
  registrationId: string,
  status: "PENDING_PAYMENT" | "CONFIRMED" | "WAITLISTED" | "WITHDRAWN" | "REJECTED",
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const reg = await db.campRegistration.findUnique({
    where: { id: registrationId },
    select: { campId: true, camp: { select: { capacity: true } } },
  });
  if (!reg) return { success: false, error: "Registration not found" };

  if (status === "CONFIRMED") {
    const taken = await campSeatsTaken(reg.campId);
    if (taken >= reg.camp.capacity) {
      return { success: false, error: "The camp is already full" };
    }
  }
  await db.campRegistration.update({
    where: { id: registrationId },
    data: { status },
  });
  revalidatePath(`/admin/camps/${reg.campId}`);
  return { success: true };
}

/** Record money taken at the desk against an existing registration. */
export async function recordCampPayment(
  registrationId: string,
  amount: number,
  method: string,
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const reg = await db.campRegistration.findUnique({
    where: { id: registrationId },
    select: { campId: true, dueAmount: true, status: true, paidAt: true },
  });
  if (!reg) return { success: false, error: "Registration not found" };
  const paid = Math.max(0, Math.round(amount));
  if (paid <= 0) return { success: false, error: "Enter an amount above ₹0" };

  await db.campRegistration.update({
    where: { id: registrationId },
    data: {
      paidAmount: { increment: paid },
      dueAmount: Math.max(0, reg.dueAmount - paid),
      paymentMethod: method,
      // First money in stamps the cash-basis date; later top-ups keep it,
      // so revenue never hops months when a balance is settled late.
      ...(reg.paidAt ? {} : { paidAt: new Date() }),
      // Collecting the balance is also what confirms a pending seat.
      ...(reg.status === "PENDING_PAYMENT" ? { status: "CONFIRMED" as const } : {}),
    },
  });
  revalidatePath(`/admin/camps/${reg.campId}`);
  return { success: true };
}

/** Soft-delete: keeps the payment trail, frees the seat. */
export async function archiveCampRegistration(
  registrationId: string,
  archived = true,
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const reg = await db.campRegistration.findUnique({
    where: { id: registrationId },
    select: { campId: true },
  });
  if (!reg) return { success: false, error: "Registration not found" };
  await db.campRegistration.update({
    where: { id: registrationId },
    data: { archivedAt: archived ? new Date() : null },
  });
  revalidatePath(`/admin/camps/${reg.campId}`);
  return { success: true };
}
