import { api } from "./api";
import type { UpiConfigResponse } from "./types";

/**
 * Mobile-only payment-related API calls. Keeps UPI/payment concerns
 * separate from `bookings.ts` so the booking client doesn't grow into
 * a god-object.
 */
export const paymentsApi = {
  /**
   * Fetches the merchant's UPI VPA and display name for the
   * "Pay with UPI App" deep link in UpiQrCheckout.
   */
  upiConfig: () => api.get<UpiConfigResponse>("/api/mobile/upi-config"),
};
