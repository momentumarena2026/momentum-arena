import { Platform } from "react-native";
import RazorpayCheckout from "react-native-razorpay";
import type {
  PaymentErrorData,
  PaymentSuccessData,
} from "react-native-razorpay/src/types";
import { api, ApiError } from "./api";
import { env } from "../config/env";
import { tokenStorage } from "./storage";

/**
 * API client for the customer-facing shop on mobile. Mirrors the
 * web /shop surface — same product list, same cart semantics, same
 * checkout dispatch. All endpoints are under /api/mobile/shop and
 * gated on mobile JWT auth.
 */

export type ProductOrderStatus =
  | "PENDING"
  | "CONFIRMED"
  | "FULFILLED"
  | "CANCELLED"
  | "REFUNDED";

export type ShopPaymentMethod = "RAZORPAY" | "UPI_QR" | "CASH";

export interface PublicProduct {
  id: string;
  name: string;
  description: string | null;
  pricePaise: number;
  stockQuantity: number;
  isInStock: boolean;
  imageUrl: string | null;
  categoryId: string | null;
  categoryName: string | null;
}

export interface CartLine {
  productId: string;
  name: string;
  pricePaise: number;
  quantity: number;
  stockQuantity: number;
  imageUrl: string | null;
  unavailable: boolean;
}

export interface CartSnapshot {
  lines: CartLine[];
  totalPaise: number;
  itemCount: number;
}

export interface ShopOrder {
  id: string;
  orderNumber: string | null;
  status: ProductOrderStatus;
  totalPaise: number;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  fulfilledAt: string | null;
  items: Array<{
    id: string;
    nameSnapshot: string;
    priceEachPaise: number;
    quantity: number;
    product: { imageUrl: string | null };
  }>;
  payment: {
    method: string;
    status: string;
    amount: number;
    razorpayPaymentId: string | null;
    utrNumber: string | null;
  } | null;
}

export interface ShopOrderListItem {
  id: string;
  orderNumber: string | null;
  status: ProductOrderStatus;
  totalPaise: number;
  createdAt: string;
  items: Array<{ id: string; nameSnapshot: string; quantity: number }>;
  payment: { method: string; status: string } | null;
}

export interface RazorpayInitResponse {
  orderId: string;
  keyId: string;
  razorpayOrderId: string;
  amount: number; // rupees
  currency: "INR";
}

/**
 * Razorpay has already captured the money by the time verify runs, so a 401
 * anywhere on that path must NOT reach the global unauthorized handler in
 * `api` — signing the user out mid-verify strands a paid order with no
 * reference left anywhere on screen. These calls therefore go straight to
 * fetch and let the caller decide what a 401 means.
 */
async function sessionSafeRequest<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<T> {
  const token = await tokenStorage.read();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Platform": Platform.OS === "ios" ? "ios" : "android",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (err) {
    throw new ApiError(
      `Network error reaching ${path}: ${err instanceof Error ? err.message : String(err)}`,
      0,
      null,
    );
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const errMsg =
      (typeof payload === "object" && payload && "error" in payload
        ? String((payload as { error: unknown }).error)
        : null) || `Request failed with ${res.status}`;
    throw new ApiError(errMsg, res.status, payload);
  }
  return payload as T;
}

export const shopApi = {
  products: () =>
    api.get<{ products: PublicProduct[] }>("/api/mobile/shop/products", {
      auth: false,
    }),

  getCart: () => api.get<{ cart: CartSnapshot }>("/api/mobile/shop/cart"),

  addToCart: (productId: string, quantity = 1) =>
    api.post<{ cart: CartSnapshot }>("/api/mobile/shop/cart", {
      op: "add",
      productId,
      quantity,
    }),

  setCartQuantity: (productId: string, quantity: number) =>
    api.post<{ cart: CartSnapshot }>("/api/mobile/shop/cart", {
      op: "set",
      productId,
      quantity,
    }),

  clearCart: () =>
    api.post<{ cart: CartSnapshot }>("/api/mobile/shop/cart", { op: "clear" }),

  mergeCart: (lines: Array<{ productId: string; quantity: number }>) =>
    api.post<{ cart: CartSnapshot }>("/api/mobile/shop/cart", {
      op: "merge",
      lines,
    }),

  myOrders: () =>
    api.get<{ orders: ShopOrderListItem[] }>("/api/mobile/shop/orders"),

  placeOrder: (method: ShopPaymentMethod) =>
    api.post<{ orderId: string; orderNumber: string }>(
      "/api/mobile/shop/orders",
      { method },
    ),

  /**
   * `keepSessionOn401` is for reads made while a payment is in flight —
   * see sessionSafeRequest. Everywhere else the global sign-out is right.
   */
  orderDetail: (id: string, opts?: { keepSessionOn401?: boolean }) =>
    opts?.keepSessionOn401
      ? sessionSafeRequest<{ order: ShopOrder }>(
          `/api/mobile/shop/orders/${id}`,
          { method: "GET" },
        )
      : api.get<{ order: ShopOrder }>(`/api/mobile/shop/orders/${id}`),

  cancelOrder: (id: string, reason = "Cancelled by customer") =>
    api.delete<{ success: boolean }>(
      `/api/mobile/shop/orders/${id}?reason=${encodeURIComponent(reason)}`,
    ),

  razorpayCreateOrder: (orderId: string) =>
    api.post<RazorpayInitResponse>("/api/mobile/shop/razorpay/create-order", {
      orderId,
    }),

  razorpayVerify: (body: {
    orderId: string;
    razorpayPaymentId: string;
    razorpayOrderId: string;
    razorpaySignature: string;
  }) =>
    sessionSafeRequest<{ success: boolean; orderId: string }>(
      "/api/mobile/shop/razorpay/verify",
      { method: "POST", body },
    ),
};

/**
 * The Razorpay webhook reconciles shop orders too — it finds the order via
 * productOrderPayment.razorpayOrderId (app/api/razorpay/webhook/route.ts) —
 * so a CONFIRMED order here may be the webhook's doing rather than our verify
 * POST. Either way this read is the authority on every exit from the sheet.
 */
export async function shopOrderIsPaid(orderId: string): Promise<boolean> {
  try {
    const { order } = await shopApi.orderDetail(orderId, {
      keepSessionOn401: true,
    });
    return order.status === "CONFIRMED" || order.status === "FULFILLED";
  } catch {
    return false;
  }
}

/**
 * Only a PENDING order can be paid — an admin may have confirmed it at the
 * counter or cancelled it while the sheet was up, and create-order 404s on
 * anything else. Checked before re-opening the sheet so that case reads as
 * "already handled" instead of a gateway error.
 */
export async function shopOrderIsPayable(orderId: string): Promise<boolean> {
  try {
    const { order } = await shopApi.orderDetail(orderId, {
      keepSessionOn401: true,
    });
    return order.status === "PENDING";
  } catch {
    // Couldn't read the status — let the attempt through; create-order is
    // the authority and refuses anything that isn't still PENDING.
    return true;
  }
}

/**
 * Orders whose Razorpay sheet we opened in this app session, and when. Money
 * may be captured against any of them, which drives two things: reads for the
 * order must not trip the global sign-out (see sessionSafeRequest), and a
 * re-mint has to wait out webhook lag first (see payShopOrderWithRazorpay).
 * Entries age out so an ordinary "pay later" visit behaves normally again.
 */
const sheetOpenedAt = new Map<string, number>();
const SHEET_RECENT_MS = 5 * 60 * 1000;

export function shopPaymentInFlight(orderId: string): boolean {
  const at = sheetOpenedAt.get(orderId);
  return at !== undefined && Date.now() - at < SHEET_RECENT_MS;
}

/**
 * A capture the SDK reported as a cancel/error only becomes visible once the
 * webhook confirms the order server-side, a few seconds behind the sheet.
 * `wait` buys that lag, and is worth its dead time only before an action that
 * would otherwise strand the payment.
 */
async function shopOrderSettled(
  orderId: string,
  opts: { wait: boolean },
): Promise<boolean> {
  const attempts = opts.wait ? 4 : 1;
  for (let i = 0; i < attempts; i += 1) {
    if (i > 0) {
      await new Promise<void>((r) => setTimeout(() => r(), 1200));
    }
    if (await shopOrderIsPaid(orderId)) return true;
  }
  return false;
}

export type ShopRazorpayOutcome = "paid" | "cancelled";

/**
 * Drives one Razorpay attempt against an existing PENDING shop order:
 * mint the gateway order → open the sheet → verify (with retries).
 *
 * Lives here rather than in a screen because BOTH the checkout screen and
 * the order-detail screen have to run it. placeOrder drains the cart the
 * moment the order exists, so an order that loses its checkout session —
 * sheet dismissed, app backgrounded, order re-opened from the orders list —
 * has no other route back to a payable sheet.
 */
export async function payShopOrderWithRazorpay(params: {
  orderId: string;
  themeColor: string;
  prefill?: { name?: string; email?: string; contact?: string };
}): Promise<ShopRazorpayOutcome> {
  const { orderId } = params;
  // create-order re-stamps productOrderPayment.razorpayOrderId, which is the
  // only pointer the webhook has back to this order — overwriting it while a
  // capture from an earlier attempt is still in flight orphans that payment.
  // So an order that already had a sheet open in this session gets the webhook
  // a moment to land before we mint anything new.
  if (await shopOrderSettled(orderId, { wait: shopPaymentInFlight(orderId) })) {
    return "paid";
  }
  const initRes = await shopApi.razorpayCreateOrder(orderId);
  sheetOpenedAt.set(orderId, Date.now());
  let success: PaymentSuccessData;
  try {
    success = (await RazorpayCheckout.open({
      key: initRes.keyId,
      // Server-side total, never a caller-computed one — the cart the
      // checkout screen priced from is already gone by this point.
      amount: Math.round(initRes.amount * 100),
      currency: initRes.currency,
      name: "Momentum Arena",
      description: `Shop order #${orderId.slice(-6).toUpperCase()}`,
      order_id: initRes.razorpayOrderId,
      prefill: params.prefill,
      theme: { color: params.themeColor },
    })) as PaymentSuccessData;
  } catch (err) {
    const e = err as PaymentErrorData;
    // The SDK reports a capture as an error — and the "Back" press off a stuck
    // bank page as a cancel — often enough that neither can be believed on its
    // own; CheckoutScreen.settledByWebhook documents the same case for
    // bookings. Ask the server before calling this anything but paid.
    if (await shopOrderIsPaid(orderId)) return "paid";
    if (e?.code === 2 || e?.description?.toLowerCase().includes("cancel")) {
      return "cancelled";
    }
    throw new Error(e?.description || "Payment failed");
  }
  if (
    !success.razorpay_payment_id ||
    !success.razorpay_order_id ||
    !success.razorpay_signature
  ) {
    if (await shopOrderIsPaid(orderId)) return "paid";
    throw new Error(
      "We couldn't confirm the payment. If money was debited, don't pay again — show this order at the front desk.",
    );
  }
  // Razorpay has captured the money by now. A dropped response here is the
  // one failure with no server-side safety net, so retry the (idempotent)
  // verify on transient errors and treat an already-confirmed order as done.
  const verifyBody = {
    orderId,
    razorpayPaymentId: success.razorpay_payment_id,
    razorpayOrderId: success.razorpay_order_id,
    razorpaySignature: success.razorpay_signature,
  };
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) {
      await new Promise<void>((r) => setTimeout(() => r(), 1000 * attempt));
      if (await shopOrderIsPaid(orderId)) return "paid";
    }
    try {
      await shopApi.razorpayVerify(verifyBody);
      return "paid";
    } catch (err) {
      lastErr = err;
      // A 401 means the token died while the money was in flight. Retrying
      // can't fix that, and the session is deliberately left intact (see
      // sessionSafeRequest) — so hand the customer the payment id, which is
      // the only reference they'll have at the counter.
      if (err instanceof ApiError && err.status === 401) {
        throw new Error(
          `Your session expired before we could confirm payment ${success.razorpay_payment_id}. Don't pay again — show this order at the front desk.`,
        );
      }
      // Other 4xx answers (bad signature, order mismatch, wrong status) are
      // verdicts, not blips — retrying them just delays the message.
      const transient =
        !(err instanceof ApiError) || err.status === 0 || err.status >= 500;
      if (!transient) break;
    }
  }
  if (await shopOrderIsPaid(orderId)) return "paid";
  throw lastErr instanceof Error
    ? lastErr
    : new Error("We couldn't confirm the payment.");
}
