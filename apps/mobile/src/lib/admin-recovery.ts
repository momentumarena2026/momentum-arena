import { request } from "./admin-api";

/**
 * Razorpay payment-recovery tool. Mirrors web /admin/bookings/recovery.
 * The route forwards the action's RecoverRazorpayResult verbatim, so
 * the screen renders created / already-linked / no-hold / error from
 * the same shape.
 */
export interface RecoverRazorpayResult {
  success: boolean;
  state?: "created" | "already-linked" | "no-hold";
  bookingId?: string;
  payment?: {
    id: string;
    orderId: string;
    amountRupees: number;
    status: string;
    captured: boolean;
    contact: string | null;
    email: string | null;
    createdAt: number;
  };
  error?: string;
}

export const adminRecoveryApi = {
  recover: (paymentId: string) =>
    request<RecoverRazorpayResult>("/api/mobile/admin/bookings/recovery", {
      method: "POST",
      body: { paymentId },
    }),
};
