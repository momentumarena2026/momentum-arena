/**
 * Shared constants for third-party organiser billing.
 *
 * Deliberately NOT in actions/admin-tournament-organizer.ts: that file is
 * "use server", and such a module may only export async functions. Exporting
 * this array from there made the whole module fail to load, so the client
 * import never resolved and the Organiser & Payments tab hung on "Loading…"
 * with no error anywhere.
 */

/** Methods an organiser actually pays by. Stored as a string on the payment
 *  row rather than a Prisma enum, so adding one never needs a migration. */
export const ORGANIZER_PAYMENT_METHODS = [
  "CASH",
  "BANK_TRANSFER",
  "UPI",
  "CHEQUE",
  "RAZORPAY",
] as const;

export type OrganizerPaymentMethod = (typeof ORGANIZER_PAYMENT_METHODS)[number];

export const ORGANIZER_METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  UPI: "UPI",
  CHEQUE: "Cheque",
  RAZORPAY: "Razorpay",
};
