import { request } from "./admin-api";

/**
 * Mobile admin payment-gateway settings client. Mirrors the web
 * /admin/payment-settings PaymentSettings shape. GET returns the config;
 * each mutation POSTs a single change and returns the refreshed config.
 */

export type PaymentGateway = "PHONEPE" | "RAZORPAY";
export type PaymentMethodFlag = "online" | "upi_qr" | "advance";

export interface PaymentSettings {
  activeGateway: PaymentGateway;
  onlineEnabled: boolean;
  upiQrEnabled: boolean;
  advanceEnabled: boolean;
  /** Admin toggle for the DQR (dynamic QR) UPI flow. */
  dqrEnabled: boolean;
  /** Whether the PHONEPE_DQR_* env creds are present (read-only). */
  dqrConfigured: boolean;
}

export const adminPaymentSettingsApi = {
  get: () =>
    request<{ config: PaymentSettings }>("/api/mobile/admin/payment-settings", {
      method: "GET",
    }),

  setGateway: (gateway: PaymentGateway) =>
    request<{ config: PaymentSettings }>("/api/mobile/admin/payment-settings", {
      method: "POST",
      body: { action: "gateway", gateway },
    }),

  setMethod: (method: PaymentMethodFlag, enabled: boolean) =>
    request<{ config: PaymentSettings }>("/api/mobile/admin/payment-settings", {
      method: "POST",
      body: { action: "method", method, enabled },
    }),

  setDqr: (enabled: boolean) =>
    request<{ config: PaymentSettings }>("/api/mobile/admin/payment-settings", {
      method: "POST",
      body: { action: "dqr", enabled },
    }),
};
