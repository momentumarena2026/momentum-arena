/**
 * How a tournament team's entry fee can be taken at the venue.
 *
 * Lives in lib/ rather than beside the action because a "use server"
 * module may only export async functions — exporting a const from
 * actions/admin-tournaments.ts compiles fine and then fails at runtime,
 * which is how the Organiser tab once hung on "Loading…".
 */

/**
 * Methods valid for COLLECTING an outstanding balance. "FREE" is
 * deliberately absent: waiving a fee is not a collection, and allowing it
 * here would let an admin zero a due amount while recording money that
 * never arrived.
 */
export const TEAM_COLLECT_METHODS = ["CASH", "STATIC_QR"] as const;
export type TeamCollectMethod = (typeof TEAM_COLLECT_METHODS)[number];

/** Methods valid when first registering a team at the counter. */
export const TEAM_REGISTER_METHODS = ["CASH", "STATIC_QR", "FREE"] as const;
export type TeamRegisterMethod = (typeof TEAM_REGISTER_METHODS)[number];

/**
 * Display labels. STATIC_QR is the venue's printed UPI QR — staff call it
 * "UPI", so lead with that word or nobody finds it.
 */
export const TEAM_PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  STATIC_QR: "UPI (static QR at counter)",
  FREE: "Free entry",
};

export function teamPaymentMethodLabel(method: string | null | undefined) {
  if (!method) return "";
  return TEAM_PAYMENT_METHOD_LABEL[method] ?? method;
}
