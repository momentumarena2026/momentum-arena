"use server";

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { arePassesEnabled, passLiveStatus, listUserPasses } from "@/lib/passes";
import { parseBands, bandKey, bandsSummary } from "@/lib/pass-bands";
import { courtGroupLabel } from "@/lib/court-config";
import { normalizeIndianPhone } from "@/lib/phone";

/**
 * Customer-facing pass reads. Purchase runs through
 * /api/passes/create-order + verify (money-first); redemption lives
 * in the checkout flow.
 */

export async function getActivePassPlans() {
  // Storefront switch — OFF hides every plan from customers while
  // sold passes keep redeeming at checkout.
  if (!(await arePassesEnabled())) return [];
  const plans = await db.passPlan.findMany({
    where: { isActive: true },
    include: {
      courtConfig: {
        select: {
          label: true,
          size: true,
          category: true,
          prices: {
            select: { dayType: true, timeType: true, pricePerSlot: true },
          },
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
  });
  return plans
    .map((p) => {
      const bands = parseBands(p.bands);
      // Hide plans whose bands no longer price at the anchor (a sport
      // price change drifted them). Legacy unrestricted plans (no bands)
      // stay visible.
      const priceByBand = new Map(
        p.courtConfig.prices.map((r) => [
          `${r.dayType}-${r.timeType}`,
          r.pricePerSlot,
        ]),
      );
      const validBands =
        p.anchorPrice == null
          ? bands
          : bands.filter((b) => priceByBand.get(bandKey(b)) === p.anchorPrice);
      const pricingValid = bands.length === 0 || validBands.length > 0;
      return { p, bands, pricingValid };
    })
    .filter((x) => x.pricingValid)
    .map(({ p, bands }) => ({
      id: p.id,
      name: p.name,
      sport: String(p.sport),
      courtLabel: courtGroupLabel({
        sport: String(p.sport),
        size: String(p.courtConfig.size),
        category: p.courtConfig.category ? String(p.courtConfig.category) : null,
        label: p.courtConfig.label,
      }),
      isBowling: p.courtConfig.category === "BOWLING_MACHINE",
      hours: p.totalMinutes / 60,
      baseAmount: p.baseAmount,
      price: p.price,
      discountPercent: p.discountPercent,
      anchorPricePerHour: p.anchorPricePerHour,
      effectiveHourly: Math.round(p.price / (p.totalMinutes / 60)),
      validityDays: p.validityDays,
      bandsSummary: bandsSummary(bands),
    }));
}

export async function getMyPasses() {
  const session = await auth();
  if (!session?.user?.id) return [];
  // Owned passes + passes shared with me (member) — shared shape with
  // the mobile /api/mobile/passes route.
  return listUserPasses(session.user.id);
}

// ─── Pass detail + shared members ───────────────────────────────────

/** "5am – 7am" style label from a booking's slots. */
function slotWindowLabel(
  slots: { startHour: number; startMinute: number; durationMinutes: number }[],
): string {
  if (slots.length === 0) return "—";
  const startMins = slots.map((s) => s.startHour * 60 + s.startMinute);
  const endMins = slots.map(
    (s) => s.startHour * 60 + s.startMinute + s.durationMinutes,
  );
  const fmt = (m: number) => {
    const h24 = Math.floor(m / 60) % 24;
    const min = m % 60;
    const ampm = h24 >= 12 ? "pm" : "am";
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return min === 0 ? `${h12}${ampm}` : `${h12}:${String(min).padStart(2, "0")}${ampm}`;
  };
  return `${fmt(Math.min(...startMins))} – ${fmt(Math.max(...endMins))}`;
}

/**
 * Full pass detail for the customer detail page. Visible to the OWNER
 * and to shared MEMBERS; only the owner may edit members. Returns null
 * when the pass doesn't exist or the viewer has no relation to it.
 */
export async function getPassDetail(passId: string) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const viewerId = session.user.id;

  const pass = await db.userPass.findUnique({
    where: { id: passId },
    include: {
      user: { select: { id: true, name: true, phone: true } },
      courtConfig: {
        select: {
          label: true,
          size: true,
          category: true,
          maxPassMembers: true,
        },
      },
      members: {
        orderBy: { addedAt: "asc" },
        include: { user: { select: { id: true, name: true, phone: true } } },
      },
      redemptions: {
        orderBy: { createdAt: "desc" },
        select: {
          minutes: true,
          value: true,
          createdAt: true,
          restoredAt: true,
          bookingId: true,
        },
      },
    },
  });
  if (!pass) return null;

  const isOwner = pass.userId === viewerId;
  const isMember = pass.members.some((m) => m.userId === viewerId);
  if (!isOwner && !isMember) return null;

  // Booking context for each redemption (date, window, who booked).
  const bookings = await db.booking.findMany({
    where: { id: { in: pass.redemptions.map((r) => r.bookingId) } },
    select: {
      id: true,
      date: true,
      status: true,
      user: { select: { name: true } },
      slots: {
        select: { startHour: true, startMinute: true, durationMinutes: true },
      },
    },
  });
  const bookingById = new Map(bookings.map((b) => [b.id, b]));

  return {
    id: pass.id,
    name: pass.name,
    sport: String(pass.sport),
    courtLabel: courtGroupLabel({
      sport: String(pass.sport),
      size: String(pass.courtConfig.size),
      category: pass.courtConfig.category
        ? String(pass.courtConfig.category)
        : null,
      label: pass.courtConfig.label,
    }),
    bandsSummary: bandsSummary(parseBands(pass.bands)),
    totalMinutes: pass.totalMinutes,
    remainingMinutes: pass.remainingMinutes,
    price: pass.price,
    validityDays: pass.validityDays,
    purchasedAt: pass.purchasedAt.toISOString(),
    startsAt: pass.startsAt.toISOString(),
    expiresAt: pass.expiresAt.toISOString(),
    status: passLiveStatus(pass),
    role: isOwner ? ("owner" as const) : ("member" as const),
    maxMembers: pass.courtConfig.maxPassMembers,
    owner: { name: pass.user.name, phone: pass.user.phone },
    members: pass.members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      phone: m.user.phone,
      addedAt: m.addedAt.toISOString(),
    })),
    bookings: pass.redemptions.map((r) => {
      const b = bookingById.get(r.bookingId);
      return {
        bookingId: r.bookingId,
        date: b?.date.toISOString() ?? null,
        timeLabel: b ? slotWindowLabel(b.slots) : "—",
        bookingStatus: b?.status ?? "—",
        bookedBy: b?.user?.name ?? null,
        minutes: r.minutes,
        value: r.value,
        restored: !!r.restoredAt,
        redeemedAt: r.createdAt.toISOString(),
      };
    }),
  };
}

/**
 * Owner adds a member by registered phone number. If the number isn't
 * registered, returns notRegistered so the UI can offer a WhatsApp
 * invite instead. Cap = CourtConfig.maxPassMembers for the pass's court.
 */
export async function addPassMemberByPhone(
  passId: string,
  phoneRaw: string,
): Promise<
  | { ok: true; member: { userId: string; name: string | null; phone: string | null } }
  | { ok: false; error: string; notRegistered?: boolean; phone?: string }
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sign in first." };

  const pass = await db.userPass.findUnique({
    where: { id: passId },
    include: {
      courtConfig: { select: { maxPassMembers: true } },
      _count: { select: { members: true } },
    },
  });
  if (!pass) return { ok: false, error: "Pass not found." };
  if (pass.userId !== session.user.id) {
    return { ok: false, error: "Only the pass owner can manage members." };
  }
  if (pass.status === "CANCELLED") {
    return { ok: false, error: "This pass is cancelled." };
  }

  const max = pass.courtConfig.maxPassMembers;
  if (max <= 0) {
    return { ok: false, error: "Sharing isn't enabled for this pass." };
  }
  if (pass._count.members >= max) {
    return {
      ok: false,
      error: `Member limit reached (${max} member${max === 1 ? "" : "s"} max).`,
    };
  }

  const phone = normalizeIndianPhone(phoneRaw);
  if (phone.length !== 12 || !phone.startsWith("91")) {
    return { ok: false, error: "Enter a valid 10-digit Indian mobile number." };
  }

  const user = await db.user.findUnique({
    where: { phone },
    select: { id: true, name: true, phone: true },
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
    return { ok: false, error: "That's you — the owner is always included." };
  }

  try {
    await db.passMember.create({
      data: { userPassId: passId, userId: user.id, addedBy: "OWNER" },
    });
  } catch {
    return { ok: false, error: "They're already a member of this pass." };
  }
  revalidatePath(`/passes/${passId}`);
  return { ok: true, member: { userId: user.id, name: user.name, phone: user.phone } };
}

/** Owner removes a member. */
export async function removePassMember(
  passId: string,
  memberUserId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sign in first." };

  const pass = await db.userPass.findUnique({
    where: { id: passId },
    select: { userId: true },
  });
  if (!pass) return { ok: false, error: "Pass not found." };
  if (pass.userId !== session.user.id) {
    return { ok: false, error: "Only the pass owner can manage members." };
  }

  await db.passMember
    .delete({
      where: {
        userPassId_userId: { userPassId: passId, userId: memberUserId },
      },
    })
    .catch(() => {});
  revalidatePath(`/passes/${passId}`);
  return { ok: true };
}
