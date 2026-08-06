"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * Part-paid cafe orders and their catch-up payments.
 *
 * The counter rings up ₹100, the customer hands over ₹20 cash + ₹50 UPI and
 * says they'll bring the rest tomorrow. CafePayment holds what was taken at
 * the counter (status PARTIAL); each later instalment is a
 * CafeOrderSettlement row carrying its OWN date, because cafe revenue is
 * cash-basis and tomorrow's ₹30 must book to tomorrow.
 *
 * The outstanding figure is always DERIVED — order total minus everything
 * captured — never stored. A stored balance is a second source of truth
 * that drifts the first time an order is edited.
 */

export interface CafeDueSummary {
  orderId: string;
  orderNumber: string;
  totalAmount: number;
  /** Taken at the counter (CafePayment.amount when PARTIAL/COMPLETED). */
  collectedAtCounter: number;
  /** Sum of later instalments. */
  collectedLater: number;
  /** total − collected, floored at 0. */
  dueAmount: number;
  settlements: {
    id: string;
    amount: number;
    cashAmount: number;
    upiAmount: number;
    method: string;
    receivedAt: Date;
    note: string | null;
  }[];
}

/** Money captured on an order so far, from both sources. */
function capturedFrom(
  payment: { status: string; amount: number } | null,
  settlements: { amount: number }[],
): { counter: number; later: number } {
  // PENDING means nothing has been taken yet — it is the expected amount,
  // not a receipt. REFUNDED/FAILED likewise contribute nothing.
  const counter =
    payment && (payment.status === "COMPLETED" || payment.status === "PARTIAL")
      ? payment.amount
      : 0;
  return { counter, later: settlements.reduce((sum, s) => sum + s.amount, 0) };
}

export async function getCafeOrderDue(orderId: string): Promise<CafeDueSummary | null> {
  await requireAdmin("MANAGE_CAFE_ORDERS");
  const order = await db.cafeOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      totalAmount: true,
      payment: { select: { status: true, amount: true } },
      settlements: {
        orderBy: { receivedAt: "asc" },
        select: {
          id: true,
          amount: true,
          cashAmount: true,
          upiAmount: true,
          method: true,
          receivedAt: true,
          note: true,
        },
      },
    },
  });
  if (!order) return null;

  const { counter, later } = capturedFrom(order.payment, order.settlements);
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    totalAmount: order.totalAmount,
    collectedAtCounter: counter,
    collectedLater: later,
    dueAmount: Math.max(0, round2(order.totalAmount - counter - later)),
    settlements: order.settlements,
  };
}

/** Rupee amounts are Float; keep arithmetic from producing 29.999999996. */
function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Record a catch-up payment. Cash, UPI, or a split of both — the same shape
 * as the counter, because a customer settling a balance can split it too.
 */
export async function settleCafeOrderDue(input: {
  orderId: string;
  cashAmount: number;
  upiAmount: number;
  /** Date-only string. Defaults to today when omitted. */
  receivedAt?: string;
  note?: string;
}): Promise<{ success: true; dueAmount: number } | { success: false; error: string }> {
  const admin = await requireAdmin("MANAGE_CAFE_ORDERS");

  const cash = Math.max(0, round2(input.cashAmount || 0));
  const upi = Math.max(0, round2(input.upiAmount || 0));
  const amount = round2(cash + upi);
  if (amount <= 0) {
    return { success: false, error: "Enter a cash or UPI amount" };
  }

  const order = await db.cafeOrder.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      totalAmount: true,
      payment: { select: { id: true, status: true, amount: true } },
      settlements: { select: { amount: true } },
    },
  });
  if (!order) return { success: false, error: "Order not found" };

  const { counter, later } = capturedFrom(order.payment, order.settlements);
  const due = round2(order.totalAmount - counter - later);
  if (due <= 0.01) {
    return { success: false, error: "This order is already fully paid" };
  }
  // Refuse to take more than is owed: an overpayment here would make
  // captured exceed the order total and quietly inflate cafe revenue.
  if (amount - due > 0.01) {
    return { success: false, error: `That is more than the ₹${due} outstanding` };
  }

  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
  if (Number.isNaN(receivedAt.getTime())) {
    return { success: false, error: "Enter a valid date" };
  }

  const remaining = round2(due - amount);

  await db.$transaction(async (tx) => {
    await tx.cafeOrderSettlement.create({
      data: {
        orderId: order.id,
        amount,
        cashAmount: cash,
        upiAmount: upi,
        method: upi > cash ? "UPI_QR" : "CASH",
        receivedAt,
        note: input.note?.trim() || null,
        recordedBy: admin.id,
      },
    });
    // Flip the counter payment to COMPLETED once nothing is outstanding, so
    // the order stops reading as part-paid everywhere. Its amount and
    // confirmedAt are deliberately NOT touched — that row is the receipt
    // for what was taken at the counter, on the day it was taken.
    if (remaining <= 0.01 && order.payment) {
      await tx.cafePayment.update({
        where: { id: order.payment.id },
        data: { status: "COMPLETED" },
      });
    }
  });

  revalidatePath("/admin/cafe/orders");
  revalidatePath(`/admin/cafe/orders/${order.id}`);
  return { success: true, dueAmount: Math.max(0, remaining) };
}

/** Orders still owing money, newest first — the "who owes us" list. */
export async function listCafeOrdersWithDue(): Promise<CafeDueSummary[]> {
  await requireAdmin("MANAGE_CAFE_ORDERS");
  const orders = await db.cafeOrder.findMany({
    where: { payment: { status: "PARTIAL" } },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      orderNumber: true,
      totalAmount: true,
      payment: { select: { status: true, amount: true } },
      settlements: {
        orderBy: { receivedAt: "asc" },
        select: {
          id: true,
          amount: true,
          cashAmount: true,
          upiAmount: true,
          method: true,
          receivedAt: true,
          note: true,
        },
      },
    },
  });
  return orders.map((o) => {
    const { counter, later } = capturedFrom(o.payment, o.settlements);
    return {
      orderId: o.id,
      orderNumber: o.orderNumber,
      totalAmount: o.totalAmount,
      collectedAtCounter: counter,
      collectedLater: later,
      dueAmount: Math.max(0, round2(o.totalAmount - counter - later)),
      settlements: o.settlements,
    };
  });
}
