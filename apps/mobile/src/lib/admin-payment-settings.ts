import { request } from "./admin-api";

/**
 * Mobile admin payment-gateway settings client. Mirrors the web
 * /admin/payment-settings PaymentSettings shape. GET returns the config;
 * each mutation POSTs a single change and returns the refreshed config.
 */

export type PaymentGateway = "PHONEPE" | "RAZORPAY";
export type PaymentMethodFlag = "online" | "advance";
/**
 * UPI QR presentation at checkout. STATIC = venue QR + manual UTR,
 * DQR = per-order PhonePe QR auto-confirmed via callback, OFF = hidden.
 * Modes are mutually exclusive; the server switches atomically.
 */
export type UpiMode = "STATIC" | "DQR" | "OFF";

export interface PaymentSettings {
  activeGateway: PaymentGateway;
  onlineEnabled: boolean;
  upiQrEnabled: boolean;
  advanceEnabled: boolean;
  /** Admin toggle for the DQR (dynamic QR) UPI flow. */
  dqrEnabled: boolean;
  /** UPI Intent (tap to pay) inside the DQR payment sheet. */
  intentEnabled: boolean;
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

  /** Atomic exclusive switch between STATIC / DQR / OFF. */
  setUpiMode: (upiMode: UpiMode) =>
    request<{ config: PaymentSettings }>("/api/mobile/admin/payment-settings", {
      method: "POST",
      body: { action: "upiMode", upiMode },
    }),

  setIntent: (enabled: boolean) =>
    request<{ config: PaymentSettings }>("/api/mobile/admin/payment-settings", {
      method: "POST",
      body: { action: "intent", enabled },
    }),
};
