"use server";

import { requireAdmin } from "@/lib/admin-auth";
import {
  fetchPayments,
  fetchOrders,
  fetchRefunds,
  fetchSettlements,
  fetchDisputes,
} from "@/lib/razorpay-api";

const PAGE_SIZE = 20;

async function requireRazorpayAccess() {
  return requireAdmin("VIEW_RAZORPAY");
}

// --- Overview ---

export interface RazorpayOverview {
  totalCollected: number;
  totalRefunded: number;
  netRevenue: number;
  pendingSettlements: number;
  paymentMethodBreakdown: Record<string, number>;
  error?: string;
}

export async function getRazorpayOverview(): Promise<RazorpayOverview> {
  try {
    await requireRazorpayAccess();

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [payments, refunds, settlements] = await Promise.all([
      fetchPayments({ count: 100, from: thirtyDaysAgo }).catch(() => ({
        items: [],
        count: 0,
      })),
      fetchRefunds({ count: 100, from: thirtyDaysAgo }).catch(() => ({
        items: [],
        count: 0,
      })),
      fetchSettlements({ count: 100 }).catch(() => ({
        items: [],
        count: 0,
      })),
    ]);

    const capturedPayments = payments.items.filter(
      (p) => p.status === "captured"
    );
    const totalCollected = capturedPayments.reduce(
      (sum, p) => sum + p.amount,
      0
    );
    const totalRefunded = refunds.items.reduce((sum, r) => sum + r.amount, 0);
    const pendingSettlements = settlements.items
      .filter((s) => s.status === "created")
      .reduce((sum, s) => sum + s.amount, 0);

    const paymentMethodBreakdown: Record<string, number> = {};
    for (const p of capturedPayments) {
      const method = p.method || "unknown";
      paymentMethodBreakdown[method] =
        (paymentMethodBreakdown[method] || 0) + p.amount;
    }

    return {
      totalCollected,
      totalRefunded,
      netRevenue: totalCollected - totalRefunded,
      pendingSettlements,
      paymentMethodBreakdown,
    };
  } catch (error) {
    return {
      totalCollected: 0,
      totalRefunded: 0,
      netRevenue: 0,
      pendingSettlements: 0,
      paymentMethodBreakdown: {},
      error:
        error instanceof Error ? error.message : "Failed to fetch overview",
    };
  }
}

// --- Payments ---

export interface PaginatedResult<T> {
  items: T[];
  count: number;
  page: number;
  totalPages: number;
  error?: string;
}

export async function getRazorpayPayments(params: {
  page?: number;
  from?: string;
  to?: string;
  status?: string;
}): Promise<PaginatedResult<Record<string, unknown>>> {
  try {
    await requireRazorpayAccess();
    const page = params.page || 1;
    const skip = (page - 1) * PAGE_SIZE;

    const result = await fetchPayments({
      count: PAGE_SIZE,
      skip,
      from: params.from || undefined,
      to: params.to || undefined,
      status: params.status || undefined,
    });

    return {
      items: result.items as unknown as Record<string, unknown>[],
      count: result.count,
      page,
      totalPages: Math.max(1, Math.ceil(result.count / PAGE_SIZE)),
    };
  } catch (error) {
    return {
      items: [],
      count: 0,
      page: 1,
      totalPages: 1,
      error:
        error instanceof Error ? error.message : "Failed to fetch payments",
    };
  }
}

// --- Orders ---

export async function getRazorpayOrders(params: {
  page?: number;
  from?: string;
  to?: string;
}): Promise<PaginatedResult<Record<string, unknown>>> {
  try {
    await requireRazorpayAccess();
    const page = params.page || 1;
    const skip = (page - 1) * PAGE_SIZE;

    const result = await fetchOrders({
      count: PAGE_SIZE,
      skip,
      from: params.from || undefined,
      to: params.to || undefined,
    });

    return {
      items: result.items as unknown as Record<string, unknown>[],
      count: result.count,
      page,
      totalPages: Math.max(1, Math.ceil(result.count / PAGE_SIZE)),
    };
  } catch (error) {
    return {
      items: [],
      count: 0,
      page: 1,
      totalPages: 1,
      error: error instanceof Error ? error.message : "Failed to fetch orders",
    };
  }
}

// --- Refunds ---

export async function getRazorpayRefunds(params: {
  page?: number;
  from?: string;
  to?: string;
}): Promise<PaginatedResult<Record<string, unknown>>> {
  try {
    await requireRazorpayAccess();
    const page = params.page || 1;
    const skip = (page - 1) * PAGE_SIZE;

    const result = await fetchRefunds({
      count: PAGE_SIZE,
      skip,
      from: params.from || undefined,
      to: params.to || undefined,
    });

    return {
      items: result.items as unknown as Record<string, unknown>[],
      count: result.count,
      page,
      totalPages: Math.max(1, Math.ceil(result.count / PAGE_SIZE)),
    };
  } catch (error) {
    return {
      items: [],
      count: 0,
      page: 1,
      totalPages: 1,
      error:
        error instanceof Error ? error.message : "Failed to fetch refunds",
    };
  }
}

// --- Settlements ---

export async function getRazorpaySettlements(params: {
  page?: number;
  from?: string;
  to?: string;
}): Promise<PaginatedResult<Record<string, unknown>>> {
  try {
    await requireRazorpayAccess();
    const page = params.page || 1;
    const skip = (page - 1) * PAGE_SIZE;

    const result = await fetchSettlements({
      count: PAGE_SIZE,
      skip,
      from: params.from || undefined,
      to: params.to || undefined,
    });

    return {
      items: result.items as unknown as Record<string, unknown>[],
      count: result.count,
      page,
      totalPages: Math.max(1, Math.ceil(result.count / PAGE_SIZE)),
    };
  } catch (error) {
    return {
      items: [],
      count: 0,
      page: 1,
      totalPages: 1,
      error:
        error instanceof Error
          ? error.message
          : "Failed to fetch settlements",
    };
  }
}

// --- Disputes ---

export async function getRazorpayDisputes(params: {
  page?: number;
}): Promise<PaginatedResult<Record<string, unknown>>> {
  try {
    await requireRazorpayAccess();
    const page = params.page || 1;
    const skip = (page - 1) * PAGE_SIZE;

    const result = await fetchDisputes({
      count: PAGE_SIZE,
      skip,
    });

    return {
      items: result.items as unknown as Record<string, unknown>[],
      count: result.count,
      page,
      totalPages: Math.max(1, Math.ceil(result.count / PAGE_SIZE)),
    };
  } catch (error) {
    return {
      items: [],
      count: 0,
      page: 1,
      totalPages: 1,
      error:
        error instanceof Error ? error.message : "Failed to fetch disputes",
    };
  }
}
