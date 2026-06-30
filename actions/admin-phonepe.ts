"use server";

import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { checkPhonePeStatus } from "@/lib/phonepe";
import { DQR_CONFIRMED_BY } from "@/lib/phonepe-dqr";

/**
 * PhonePe transactions dashboard — DB-backed.
 *
 * Unlike Razorpay (which exposes merchant-wide list/settlement/refund/dispute
 * REST APIs we proxy in lib/razorpay-api), PhonePe's PG product offers only a
 * PER-ORDER status call + per-payment refund — there is NO "list all
 * transactions" / settlement / dispute API. So this dashboard reads our OWN
 * records (the source of truth for our PhonePe txns): booking `Payment` rows
 * and cafe `CafePayment` rows that went through PhonePe (gateway checkout OR
 * Dynamic-QR). The one live PhonePe action we expose is per-transaction status
 * refresh (`refreshPhonePeStatus` → checkPhonePeStatus), read-only.
 *
 * Gated on VIEW_RAZORPAY (the existing "view payment-gateway data" permission)
 * so it shares the same access as the Razorpay dashboard. Mobile admin routes
 * pre-authenticate the bearer token and pass skipAuth=true.
 */

const PAGE_SIZE = 20;

async function requireGatewayAccess() {
  return requireAdmin("VIEW_RAZORPAY");
}

// A PhonePe payment is either a gateway-checkout payment (method PHONEPE) or a
// Dynamic-QR payment (method UPI_QR confirmedBy PHONEPE_DQR) — both stamp
// phonePeMerchantTxnId. This OR captures both and excludes static-UTR QR.
const PHONEPE_WHERE = {
  OR: [
    { method: "PHONEPE" as const },
    { phonePeMerchantTxnId: { not: null } },
  ],
};

export type PhonePeTxnType = "booking" | "cafe";
export type PhonePeChannel = "CHECKOUT" | "DQR";

export interface PhonePeTxn {
  id: string;
  type: PhonePeTxnType;
  channel: PhonePeChannel;
  merchantTxnId: string | null;
  phonePeTransactionId: string | null;
  amount: number; // rupees
  status: string; // PaymentStatus
  customerName: string | null;
  customerPhone: string | null;
  bookingId: string | null;
  cafeOrderId: string | null;
  refundedAt: string | null;
  refundReason: string | null;
  createdAt: string;
}

function channelOf(method: string, confirmedBy: string | null | undefined): PhonePeChannel {
  if (confirmedBy === DQR_CONFIRMED_BY) return "DQR";
  return method === "PHONEPE" ? "CHECKOUT" : "DQR";
}

function defaultRange(from?: string, to?: string) {
  const now = new Date();
  const dateTo = to ? new Date(to + "T23:59:59.999Z") : now;
  const dateFrom = from
    ? new Date(from + "T00:00:00.000Z")
    : new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); // default 90d
  return { dateFrom, dateTo };
}

export interface PhonePeOverview {
  totalCount: number;
  completedCount: number;
  pendingCount: number;
  failedCount: number;
  totalVolume: number; // sum of COMPLETED amounts, rupees
  refundedCount: number;
  refundedAmount: number;
  byChannel: { CHECKOUT: number; DQR: number }; // completed volume per channel
  byType: { booking: number; cafe: number }; // completed volume per type
  range: { from: string; to: string };
}

export async function getPhonePeOverview(
  from?: string,
  to?: string,
  skipAuth = false,
): Promise<PhonePeOverview> {
  if (!skipAuth) await requireGatewayAccess();
  const { dateFrom, dateTo } = defaultRange(from, to);

  const [payments, cafe] = await Promise.all([
    db.payment.findMany({
      where: { ...PHONEPE_WHERE, createdAt: { gte: dateFrom, lte: dateTo } },
      select: { amount: true, status: true, method: true, confirmedBy: true, refundedAt: true },
    }),
    db.cafePayment.findMany({
      where: { ...PHONEPE_WHERE, createdAt: { gte: dateFrom, lte: dateTo } },
      select: { amount: true, status: true, method: true, confirmedBy: true, refundedAt: true },
    }),
  ]);

  const all = [
    ...payments.map((p) => ({ ...p, type: "booking" as const })),
    ...cafe.map((p) => ({ ...p, type: "cafe" as const })),
  ];

  const ov: PhonePeOverview = {
    totalCount: all.length,
    completedCount: 0,
    pendingCount: 0,
    failedCount: 0,
    totalVolume: 0,
    refundedCount: 0,
    refundedAmount: 0,
    byChannel: { CHECKOUT: 0, DQR: 0 },
    byType: { booking: 0, cafe: 0 },
    range: {
      from: dateFrom.toISOString().split("T")[0],
      to: dateTo.toISOString().split("T")[0],
    },
  };

  for (const p of all) {
    if (p.status === "COMPLETED") {
      ov.completedCount++;
      ov.totalVolume += p.amount;
      ov.byChannel[channelOf(p.method, p.confirmedBy)] += p.amount;
      ov.byType[p.type] += p.amount;
    } else if (p.status === "FAILED") {
      ov.failedCount++;
    } else {
      ov.pendingCount++;
    }
    if (p.refundedAt) {
      ov.refundedCount++;
      ov.refundedAmount += p.amount;
    }
  }
  return ov;
}

export interface PhonePeTxnPage {
  items: PhonePeTxn[];
  total: number;
  page: number;
  totalPages: number;
}

export async function getPhonePeTransactions(params: {
  from?: string;
  to?: string;
  status?: string; // PaymentStatus filter, optional
  type?: PhonePeTxnType; // booking | cafe, optional
  page?: number;
  skipAuth?: boolean;
}): Promise<PhonePeTxnPage> {
  if (!params.skipAuth) await requireGatewayAccess();
  const { dateFrom, dateTo } = defaultRange(params.from, params.to);
  const page = Math.max(params.page ?? 1, 1);

  const statusWhere = params.status ? { status: params.status as never } : {};
  const dateWhere = { createdAt: { gte: dateFrom, lte: dateTo } };

  const wantBooking = !params.type || params.type === "booking";
  const wantCafe = !params.type || params.type === "cafe";

  const [payments, cafe] = await Promise.all([
    wantBooking
      ? db.payment.findMany({
          where: { ...PHONEPE_WHERE, ...dateWhere, ...statusWhere },
          select: {
            id: true,
            amount: true,
            status: true,
            method: true,
            confirmedBy: true,
            phonePeMerchantTxnId: true,
            phonePeTransactionId: true,
            bookingId: true,
            refundedAt: true,
            refundReason: true,
            createdAt: true,
            booking: { select: { user: { select: { name: true, phone: true } } } },
          },
        })
      : Promise.resolve([]),
    wantCafe
      ? db.cafePayment.findMany({
          where: { ...PHONEPE_WHERE, ...dateWhere, ...statusWhere },
          select: {
            id: true,
            amount: true,
            status: true,
            method: true,
            confirmedBy: true,
            phonePeMerchantTxnId: true,
            phonePeTransactionId: true,
            orderId: true,
            refundedAt: true,
            refundReason: true,
            createdAt: true,
            order: {
              select: {
                guestName: true,
                guestPhone: true,
                user: { select: { name: true, phone: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const rows: PhonePeTxn[] = [
    ...payments.map((p): PhonePeTxn => ({
      id: p.id,
      type: "booking",
      channel: channelOf(p.method, p.confirmedBy),
      merchantTxnId: p.phonePeMerchantTxnId,
      phonePeTransactionId: p.phonePeTransactionId,
      amount: p.amount,
      status: p.status,
      customerName: p.booking?.user?.name ?? null,
      customerPhone: p.booking?.user?.phone ?? null,
      bookingId: p.bookingId,
      cafeOrderId: null,
      refundedAt: p.refundedAt?.toISOString() ?? null,
      refundReason: p.refundReason,
      createdAt: p.createdAt.toISOString(),
    })),
    ...cafe.map((p): PhonePeTxn => ({
      id: p.id,
      type: "cafe",
      channel: channelOf(p.method, p.confirmedBy),
      merchantTxnId: p.phonePeMerchantTxnId,
      phonePeTransactionId: p.phonePeTransactionId,
      amount: p.amount,
      status: p.status,
      customerName: p.order?.user?.name ?? p.order?.guestName ?? null,
      customerPhone: p.order?.user?.phone ?? p.order?.guestPhone ?? null,
      bookingId: null,
      cafeOrderId: p.orderId,
      refundedAt: p.refundedAt?.toISOString() ?? null,
      refundReason: p.refundReason,
      createdAt: p.createdAt.toISOString(),
    })),
  ];

  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const total = rows.length;
  const start = (page - 1) * PAGE_SIZE;
  return {
    items: rows.slice(start, start + PAGE_SIZE),
    total,
    page,
    totalPages: Math.max(Math.ceil(total / PAGE_SIZE), 1),
  };
}

export interface PhonePeStatusResult {
  ok: boolean;
  state?: string;
  success?: boolean;
  phonePeTransactionId?: string;
  amount?: number; // paise as returned by PhonePe
  error?: string;
}

/**
 * Live per-transaction status from PhonePe (the one merchant API available).
 * READ-ONLY — surfaces PhonePe's truth for the admin; does not mutate our DB
 * (reconciling a captured-but-unbooked payment is the orphan-recovery flow).
 */
export async function refreshPhonePeStatus(
  merchantTxnId: string,
  skipAuth = false,
): Promise<PhonePeStatusResult> {
  if (!skipAuth) await requireGatewayAccess();
  if (!merchantTxnId) return { ok: false, error: "No PhonePe merchant txn id on this payment" };
  try {
    const s = await checkPhonePeStatus(merchantTxnId);
    return {
      ok: true,
      state: s.state,
      success: s.success,
      phonePeTransactionId: s.transactionId,
      amount: s.amount,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Status check failed" };
  }
}
