import { api } from "./api";
import type { CafeItem } from "./types";

export interface CafeMenuResponse {
  /** Master open/closed switch from CafeSettings. When false the
   *  mobile cafe tab renders the "Cafe closed" view; when true it
   *  renders the menu (items list still populated either way). */
  isOpen: boolean;
  items: CafeItem[];
}

export type CafePaymentMethod = "RAZORPAY" | "UPI_QR" | "CASH";

export type CafeOrderStatus =
  | "PENDING_PAYMENT"
  | "PENDING"
  | "PREPARING"
  | "READY"
  | "COMPLETED"
  | "CANCELLED";

export interface CafeOrderListItemLine {
  id: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  isVeg: boolean;
}

export interface CafeOrderListItem {
  id: string;
  orderNumber: string;
  status: CafeOrderStatus;
  totalAmount: number;
  originalAmount: number | null;
  discountAmount: number;
  createdAt: string;
  items: CafeOrderListItemLine[];
  payment: {
    method: string;
    status: string;
    amount: number;
  } | null;
}

export interface CafeOrderDetail extends CafeOrderListItem {
  note: string | null;
  payment:
    | (CafeOrderListItem["payment"] & { confirmedAt: string | null })
    | null;
}

export interface CafeCreateOrderArgs {
  items: Array<{ cafeItemId: string; quantity: number }>;
  paymentMethod: CafePaymentMethod;
  discountCode?: string;
  note?: string;
}

export interface CafeCreateOrderResponse {
  ok: true;
  /**
   * For RAZORPAY this is the CafePaymentIntent id — the materialise
   * step on /razorpay/verify returns the real CafeOrder id. For
   * CASH / UPI_QR this is the real CafeOrder id directly.
   */
  orderId: string;
  intent: boolean;
  orderNumber?: string;
  status?: CafeOrderStatus;
  totalAmount?: number;
}

export interface CafeRazorpayCreateOrderResponse {
  orderId: string; // intent id (round-trip)
  razorpayOrderId: string;
  keyId: string;
  amount: number; // rupees — RazorpayCheckout expects paise so client x100
  currency: "INR";
}

export const cafeApi = {
  /** Single round-trip for the cafe tab — server resolves the
   *  open/closed flag + the menu in one query. */
  menu: () => api.get<CafeMenuResponse>("/api/mobile/cafe/items"),

  /** Create a cafe order. For RAZORPAY this stashes a
   *  CafePaymentIntent and returns its id; the verify step
   *  materialises the real CafeOrder. For CASH/UPI_QR the order
   *  lands in the DB immediately. */
  createOrder: (args: CafeCreateOrderArgs) =>
    api.post<CafeCreateOrderResponse>("/api/mobile/cafe/orders", { ...args }),

  /** Order history for the signed-in customer. */
  myOrders: () =>
    api.get<{ orders: CafeOrderListItem[] }>("/api/mobile/cafe/orders"),

  /** Per-order detail. */
  orderDetail: (id: string) =>
    api.get<{ order: CafeOrderDetail }>(`/api/mobile/cafe/orders/${id}`),

  razorpayCreateOrder: (intentId: string) =>
    api.post<CafeRazorpayCreateOrderResponse>(
      "/api/mobile/cafe/razorpay/create-order",
      { orderId: intentId },
    ),

  razorpayVerify: (body: {
    orderId: string; // intent id
    razorpayPaymentId: string;
    razorpayOrderId: string;
    razorpaySignature: string;
  }) =>
    api.post<{
      success: boolean;
      orderId: string;
      orderNumber?: string;
      status?: CafeOrderStatus;
    }>("/api/mobile/cafe/razorpay/verify", body),

  razorpayCancel: (intentId: string) =>
    api.post<{ success: boolean }>("/api/mobile/cafe/razorpay/cancel", {
      orderId: intentId,
    }),
};
