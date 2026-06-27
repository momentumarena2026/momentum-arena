import { request } from "./admin-api";

/**
 * API client for the mobile-admin Shop POS (walk-in sale) surface.
 * Mirrors the web /admin/pos page: pick in-stock products, attach a
 * customer (phone + name, resolved server-side, idempotent on phone),
 * choose payment method, ring up via placeAdminOrder.
 *
 * Money is in PAISE — divide pricePaise by 100 for ₹ display.
 */

export interface PosProduct {
  id: string;
  name: string;
  pricePaise: number;
  stockQuantity: number;
  imageUrl: string | null;
  categoryName: string | null;
}

export const adminPosApi = {
  products(): Promise<{ products: PosProduct[] }> {
    return request("/api/mobile/admin/pos", { method: "GET" });
  },

  createSale(body: {
    items: { productId: string; quantity: number }[];
    customerPhone: string;
    customerName: string;
    method: "CASH" | "UPI_QR";
    markPaid?: boolean;
    utrNumber?: string;
  }): Promise<{ ok: true; orderId: string; orderNumber: string }> {
    return request("/api/mobile/admin/pos", { method: "POST", body });
  },
};
