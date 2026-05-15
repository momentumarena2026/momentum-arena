import { api } from "./api";

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

  orderDetail: (id: string) =>
    api.get<{ order: ShopOrder }>(`/api/mobile/shop/orders/${id}`),

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
    api.post<{ success: boolean; orderId: string }>(
      "/api/mobile/shop/razorpay/verify",
      body,
    ),
};
