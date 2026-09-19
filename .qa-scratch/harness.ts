/* QA harness — NOT part of the app. Deleted at the end of the session. */
import crypto from "crypto";
import { db } from "@/lib/db";
import { postChallenge } from "@/lib/challenges";

export const SECRET = process.env.RAZORPAY_KEY_SECRET || "";
let orderSeq = 0;

/** Intercept only Razorpay order creation; everything else passes through. */
export function stubRazorpayOrders() {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input?.url ?? "";
    if (url.includes("api.razorpay.com/v1/orders")) {
      const body = JSON.parse(init?.body ?? "{}");
      const id = `order_QA${Date.now().toString(36)}${orderSeq++}`;
      return new Response(
        JSON.stringify({ id, amount: body.amount, currency: "INR", status: "created" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return real(input, init);
  }) as typeof fetch;
}

export function sign(orderId: string, paymentId: string): string {
  return crypto.createHmac("sha256", SECRET).update(`${orderId}|${paymentId}`).digest("hex");
}

export function payId(tag: string) {
  return `pay_QA${tag}${Math.random().toString(36).slice(2, 8)}`;
}

export async function ensureUser(n: number, name: string) {
  const phone = `90000050${String(n).padStart(2, "0")}`;
  const email = `qa.challenge.${phone}@example.invalid`;
  const existing = await db.user.findFirst({ where: { phone } });
  if (existing) return existing;
  return db.user.create({ data: { phone, name, email } });
}

/** A challenge posted for real, then optionally driven to AGREED. */
export async function makeChallenge(opts: {
  poster: { id: string };
  sport?: string;
  date: string;
  startHour: number;
  endHour: number;
  courtConfigId?: string | null;
}) {
  const r = await postChallenge({
    userId: opts.poster.id,
    sport: opts.sport ?? "FOOTBALL",
    teamName: "QA-CHAL",
    playerCount: 10,
    notes: "qa",
    windows: [
      {
        date: opts.date,
        startHour: opts.startHour,
        endHour: opts.endHour,
        courtConfigId: opts.courtConfigId ?? null,
      },
    ],
  });
  if (!r.ok) throw new Error(`postChallenge refused: ${r.error}`);
  const c = await db.challenge.findUnique({
    where: { id: r.id! },
    include: { windows: true },
  });
  return c!;
}

export async function snapshot(challengeId: string) {
  const c = await db.challenge.findUnique({
    where: { id: challengeId },
    include: {
      payments: { orderBy: { side: "asc" } },
      windows: true,
      booking: { include: { payment: true, slots: true } },
    },
  });
  if (!c) return null;
  return {
    status: c.status,
    bookingId: c.bookingId,
    agreedWindowId: c.agreedWindowId,
    acceptedByUserId: c.acceptedByUserId,
    confirmedNotifiedAt: c.confirmedNotifiedAt,
    booking: c.booking && {
      id: c.booking.id,
      status: c.booking.status,
      totalAmount: c.booking.totalAmount,
      court: c.booking.courtConfigId,
      pay: c.booking.payment && {
        status: c.booking.payment.status,
        amount: c.booking.payment.amount,
        advanceAmount: c.booking.payment.advanceAmount,
        remainingAmount: c.booking.payment.remainingAmount,
      },
    },
    payments: c.payments.map((p) => ({
      side: p.side,
      userId: p.userId.slice(-6),
      amount: p.amount,
      paidAt: !!p.paidAt,
      placedAt: !!p.placedAt,
      refundOwedAt: !!p.refundOwedAt,
      refundOwedReason: p.refundOwedReason,
      order: p.razorpayOrderId,
    })),
  };
}

export async function events(challengeId: string) {
  const rows = await db.challengeEvent.findMany({
    where: { challengeId },
    orderBy: { createdAt: "asc" },
    select: { type: true, detail: true },
  });
  return rows.map((r) => `${r.type}: ${r.detail ?? ""}`);
}

export async function setAdvancePct(pct: number) {
  await db.challengeSettings.update({ where: { id: "singleton" }, data: { advancePct: pct } });
}

/** Remove every challenge + booking my QA users created. Mine only. */
export async function qaUserIds(): Promise<string[]> {
  const us = await db.user.findMany({
    where: { phone: { startsWith: "90000050" } },
    select: { id: true },
  });
  return us.map((u) => u.id);
}

export async function resetQaData() {
  const ids = await qaUserIds();
  if (ids.length === 0) return;
  const chals = await db.challenge.findMany({
    where: { OR: [{ createdByUserId: { in: ids } }, { acceptedByUserId: { in: ids } }] },
    select: { id: true, bookingId: true },
  });
  const bookingIds = chals.map((c) => c.bookingId).filter((x): x is string => !!x);
  await db.challengeEvent.deleteMany({ where: { challengeId: { in: chals.map((c) => c.id) } } });
  await db.challenge.deleteMany({ where: { id: { in: chals.map((c) => c.id) } } });
  // Bookings my tests created (all of them belong to QA users).
  const bs = await db.booking.findMany({
    where: { OR: [{ id: { in: bookingIds } }, { userId: { in: ids } }] },
    select: { id: true },
  });
  const bIds = bs.map((b) => b.id);
  await db.payment.deleteMany({ where: { bookingId: { in: bIds } } });
  await db.bookingSlot.deleteMany({ where: { bookingId: { in: bIds } } });
  await db.booking.deleteMany({ where: { id: { in: bIds } } });
  await db.notification.deleteMany({ where: { userId: { in: ids } } }).catch(() => 0);
  return { challenges: chals.length, bookings: bIds.length };
}

/** A pool of posters so each scenario gets its own live challenge. */
export async function poster(n: number) {
  const u = await ensureUser(n, `QA Captain ${n}`);
  await db.challenge.deleteMany({ where: { createdByUserId: u.id } });
  return u;
}
