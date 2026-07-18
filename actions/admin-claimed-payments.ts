"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { qrStatus } from "@/lib/phonepe-dqr";
import { confirmDqrCafe } from "@/lib/dqr-confirm";
import { confirmDqrPass, materializeUserPass } from "@/lib/passes";
import { materializeOrderFromIntent } from "@/lib/cafe-intent";

export type ClaimKind = "cafe" | "pass";
export type ClaimResult =
  | { ok: true; id: string; via: "gateway" | "manual" }
  | { ok: true; rejected: true }
  | { ok: false; error: string };

/**
 * Resolve a customer-claimed payment that PhonePe hasn't confirmed.
 *
 * `verify` re-probes PhonePe first — if it has caught up, the ordinary
 * confirm path runs and nobody has to trust anyone. Only when PhonePe
 * still won't acknowledge the payment does `force` materialise the
 * order/pass on the admin's authority, which is the point at which a
 * human has checked the PhonePe Business dashboard themselves.
 *
 * Bookings don't come through here: their claim already creates a
 * PENDING booking (the slot has to be held), and the existing
 * confirm/reject actions on the bookings queue handle them.
 */
export async function resolveClaimedPayment(
  kind: ClaimKind,
  intentId: string,
  mode: "verify" | "force" | "reject",
): Promise<ClaimResult> {
  await requireAdmin();

  if (mode === "reject") {
    if (kind === "cafe") {
      await db.cafePaymentIntent.update({
        where: { id: intentId },
        data: { claimedAt: null },
      });
    } else {
      await db.passPurchaseIntent.update({
        where: { id: intentId },
        data: { claimedAt: null },
      });
    }
    revalidatePath("/admin/bookings/unconfirmed");
    return { ok: true, rejected: true };
  }

  const intent =
    kind === "cafe"
      ? await db.cafePaymentIntent.findUnique({ where: { id: intentId } })
      : await db.passPurchaseIntent.findUnique({ where: { id: intentId } });
  if (!intent) return { ok: false, error: "Purchase not found" };
  const txn = intent.phonePeMerchantTxnId;
  if (!txn) return { ok: false, error: "No PhonePe transaction on this purchase" };

  if (mode === "verify") {
    let state = "UNKNOWN";
    let providerReferenceId: string | undefined;
    try {
      const status = await qrStatus(txn);
      state = status.state;
      providerReferenceId = status.providerReferenceId;
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? `PhonePe: ${err.message}` : "PhonePe unreachable",
      };
    }
    if (state !== "COMPLETED") {
      return {
        ok: false,
        error: `PhonePe still reports this as ${state}. Check the PhonePe Business dashboard for txn ${txn} — if the money is there, use "Confirm anyway".`,
      };
    }
    const done =
      kind === "cafe"
        ? await confirmDqrCafe(txn, providerReferenceId).then((r) => r.orderId)
        : await confirmDqrPass(txn, providerReferenceId).then((r) => r.userPassId);
    if (!done) return { ok: false, error: "Couldn't complete the purchase" };
    revalidatePath("/admin/bookings/unconfirmed");
    return { ok: true, id: done, via: "gateway" };
  }

  // mode === "force": the admin has verified the money out-of-band.
  if (kind === "cafe") {
    const res = await materializeOrderFromIntent(intentId, {
      phonePeMerchantTxnId: txn,
      method: "UPI_QR",
      confirmedBy: "ADMIN_VERIFIED",
    });
    if (!res.ok) return { ok: false, error: res.error };
    await db.cafePaymentIntent.update({
      where: { id: intentId },
      data: { claimedAt: null },
    });
    revalidatePath("/admin/bookings/unconfirmed");
    revalidatePath("/admin/cafe");
    return { ok: true, id: res.orderId, via: "manual" };
  }

  const passIntent = intent as { planId: string; userId: string; startsAt: Date };
  const res = await materializeUserPass({
    planId: passIntent.planId,
    userId: passIntent.userId,
    startsAt: passIntent.startsAt,
    phonePeMerchantTxnId: txn,
  });
  if (!res) return { ok: false, error: "Plan not found" };
  await db.passPurchaseIntent.update({
    where: { id: intentId },
    data: { claimedAt: null, consumedUserPassId: res.userPassId },
  });
  revalidatePath("/admin/bookings/unconfirmed");
  revalidatePath("/admin/passes");
  return { ok: true, id: res.userPassId, via: "manual" };
}
