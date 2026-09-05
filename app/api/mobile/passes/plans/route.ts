import { NextResponse } from "next/server";
import { getActivePassPlans } from "@/actions/passes";

/**
 * Storefront plan cards — the same band-validity-filtered list the web
 * /passes page renders. Empty when the admin storefront toggle is off.
 *
 * PUBLIC, deliberately. getActivePassPlans() takes no user and returns
 * pure catalogue data: plan names, prices, hour windows. Requiring a
 * token here gained nothing and cost a sale — a signed-out customer got
 * a 401, which the store screen rendered as "No passes on sale right
 * now". The shop was telling people it had nothing to sell.
 *
 * Web has always shown these to signed-out visitors, so this also ends an
 * app-only divergence. Same reasoning as /api/mobile/courts, which is
 * public for exactly this reason: gating a catalogue behind OTP sign-in
 * just traps signed-out users on a dead-end screen.
 */
export async function GET() {
  const plans = await getActivePassPlans();
  return NextResponse.json({ plans });
}
