"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { probeUntilSettled } from "@/lib/dqr-inflight";
import { qrStatus } from "@/lib/phonepe-dqr";
import { confirmDqrCafe } from "@/lib/dqr-confirm";
import { confirmDqrPass, materializeUserPass } from "@/lib/passes";
import { materializeOrderFromIntent } from "@/lib/cafe-intent";

export type ClaimKind = "cafe" | "pass";
export type ClaimResult =
  | { ok: true; id: string; via: "gateway" | "manual" }
  | { ok: true; rejected: true }
  | {
      ok: false;
      error: string;
      /**
       * `mode: "force"` is a sound next step for this failure — the money
       * looks real but PhonePe wouldn't hand us what we need to confirm
       * automatically, so an admin who checks the Business dashboard can
       * override. Consumers MUST gate their "Confirm anyway" button on
       * this flag; the old contract was a regex over `error`, which
       * silently hid the button the moment a new message was added.
       */
      canForce?: boolean;
    };

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
  // Unconditional: this is a public server-action endpoint whose args
  // come from the client. requireAdmin resolves either the web cookie
  // session or the mobile Bearer JWT, so the mobile route's in-process
  // call is covered by the same gate.
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
  if (!intent) return { ok: false, error: "Purchase not found", canForce: false };
  const txn = intent.phonePeMerchantTxnId;
  // Forcing needs the txn too (it stamps it on the order/pass), so this
  // one is unactionable in every mode.
  if (!txn)
    return {
      ok: false,
      error: "No PhonePe transaction on this purchase",
      canForce: false,
    };

  if (mode === "verify") {
    // Same patient probe the customer's claim used — a single PENDING
    // is weak evidence, and an admin re-checking minutes later has a
    // good chance of catching a late settlement.
    // Annotated (not cast) so this compiles whether or not the probe's
    // own return type carries `amount`.
    const settled: {
      state: string;
      providerReferenceId?: string;
      amount?: number;
    } = await probeUntilSettled(txn);
    const { state, providerReferenceId } = settled;
    if (state !== "COMPLETED") {
      return {
        ok: false,
        canForce: true,
        error: `PhonePe still reports this as ${state}. Check the PhonePe Business dashboard for txn ${txn} — if the money is there, use "Confirm anyway".`,
      };
    }
    let done: string | null;
    if (kind === "cafe") {
      done = await confirmDqrCafe(txn, providerReferenceId).then((r) => r.orderId);
    } else {
      // confirmDqrPass price-checks the capture, and calling it with no
      // amount is TERMINAL: it stamps the mismatch sentinel on the intent,
      // which withholds the pass AND drops the claim out of both admin
      // queues (they match consumedUserPassId: null) — taking "Confirm
      // anyway" away with it. So only confirm once we hold an amount:
      // the probe carries one when it can, otherwise re-read it here.
      // Without one, leaving the claim in the queue for the force path
      // is the correct outcome.
      let capturedPaise = settled.amount;
      let unreachable = false;
      if (capturedPaise === undefined) {
        capturedPaise = await qrStatus(txn)
          .then((s) => s.amount)
          .catch(() => {
            // A dropped connection is not the same as PhonePe answering
            // without an amount, and telling the admin the wrong one
            // sends them to the dashboard when a retry would do.
            unreachable = true;
            return undefined;
          });
      }
      if (capturedPaise === undefined) {
        return {
          ok: false,
          canForce: true,
          error: unreachable
            ? `Couldn't reach PhonePe to read the captured amount for txn ${txn}, so the pass can't be price-checked — the last probe still reports this as ${state}. Try Verify again in a moment; if it keeps failing, check the amount on the PhonePe Business dashboard and use "Confirm anyway".`
            : `PhonePe still reports this as ${state} but didn't report an amount, so the pass can't be price-checked. Check the amount on the PhonePe Business dashboard for txn ${txn} and use "Confirm anyway".`,
        };
      }
      const pass = await confirmDqrPass(txn, providerReferenceId, capturedPaise);
      if (pass.mismatch) {
        // Terminal: the sentinel is stamped and the money is on the
        // orphan worklist — forcing would issue the pass at the wrong price.
        const capturedRupees = (capturedPaise / 100).toFixed(2).replace(/\.00$/, "");
        return {
          ok: false,
          canForce: false,
          error: `PhonePe captured ₹${capturedRupees} for txn ${txn}, which doesn't match this plan's price. The payment is on the orphan worklist — issue the pass or refund manually.`,
        };
      }
      done = pass.userPassId;
    }
    // PhonePe said COMPLETED, so the money is real even though the
    // ordinary confirm couldn't land it — the manual override applies.
    if (!done)
      return { ok: false, error: "Couldn't complete the purchase", canForce: true };
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
    if (!res.ok) return { ok: false, error: res.error, canForce: false };
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
  if (!res) return { ok: false, error: "Plan not found", canForce: false };
  await db.passPurchaseIntent.update({
    where: { id: intentId },
    data: { claimedAt: null, consumedUserPassId: res.userPassId },
  });
  revalidatePath("/admin/bookings/unconfirmed");
  revalidatePath("/admin/passes");
  return { ok: true, id: res.userPassId, via: "manual" };
}
