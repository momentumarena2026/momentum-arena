"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
// Not declared here: a "use server" module may only export async
// functions, and exporting the array from this file broke the whole
// module at load time.
import { ORGANIZER_PAYMENT_METHODS } from "@/lib/tournament-organizer";

/**
 * Money owed by a third-party organiser who hired the venue.
 *
 * This is the mirror image of the rest of tournament money: normally cash
 * flows IN from many teams (TournamentTeam.paidAmount), here it flows in
 * from one organiser against a quote we gave them. Receipts are recorded
 * by hand — the organiser pays by cash, transfer or UPI outside the app,
 * so there is no gateway callback to reconcile against.
 */
function gate() {
  return requireAdmin("MANAGE_TOURNAMENTS");
}


const paymentSchema = z.object({
  tournamentId: z.string().min(1),
  amount: z.number().int().positive().max(1_00_00_000),
  method: z.enum(ORGANIZER_PAYMENT_METHODS),
  reference: z.string().trim().max(120).optional(),
  // Date-only string from the form; the venue books by day, not by minute.
  receivedAt: z.string().min(1),
  note: z.string().trim().max(500).optional(),
});

export type OrganizerPaymentInput = z.infer<typeof paymentSchema>;

export interface OrganizerLedger {
  quotedAmount: number;
  receivedAmount: number;
  /** Never negative — an overpayment reads as 0 outstanding, not a credit. */
  outstanding: number;
  payments: {
    id: string;
    amount: number;
    method: string;
    reference: string | null;
    receivedAt: Date;
    note: string | null;
  }[];
}

export async function getOrganizerLedger(tournamentId: string): Promise<OrganizerLedger | null> {
  await gate();
  const t = await db.tournament.findUnique({
    where: { id: tournamentId },
    select: { host: true, quotedAmount: true },
  });
  if (!t || t.host !== "THIRD_PARTY") return null;

  const payments = await db.tournamentOrganizerPayment.findMany({
    where: { tournamentId },
    orderBy: { receivedAt: "desc" },
    select: {
      id: true,
      amount: true,
      method: true,
      reference: true,
      receivedAt: true,
      note: true,
    },
  });
  const receivedAmount = payments.reduce((sum, p) => sum + p.amount, 0);
  return {
    quotedAmount: t.quotedAmount,
    receivedAmount,
    outstanding: Math.max(0, t.quotedAmount - receivedAmount),
    payments,
  };
}

export async function recordOrganizerPayment(
  input: OrganizerPaymentInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await gate();
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid payment" };
  }
  const d = parsed.data;

  // Guard the host type server-side: a receipt against one of our OWN
  // tournaments would be counted as tournament revenue on top of the team
  // entry fees already recorded, i.e. the same rupee twice in the report.
  const t = await db.tournament.findUnique({
    where: { id: d.tournamentId },
    select: { host: true, slug: true },
  });
  if (!t) return { ok: false, error: "Tournament not found" };
  if (t.host !== "THIRD_PARTY") {
    return { ok: false, error: "Only third-party tournaments take organiser payments" };
  }

  const receivedAt = new Date(d.receivedAt);
  if (Number.isNaN(receivedAt.getTime())) {
    return { ok: false, error: "Enter a valid received date" };
  }

  await db.tournamentOrganizerPayment.create({
    data: {
      tournamentId: d.tournamentId,
      amount: d.amount,
      method: d.method,
      reference: d.reference || null,
      receivedAt,
      note: d.note || null,
      recordedBy: admin.id,
    },
  });

  revalidatePath(`/admin/tournaments/${d.tournamentId}`);
  return { ok: true };
}

/**
 * Delete rather than edit: a wrong receipt is corrected by removing it and
 * entering the right one. Editing an amount in place would silently move
 * money between accounting months if receivedAt changed with it.
 */
export async function deleteOrganizerPayment(
  paymentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await gate();
  const row = await db.tournamentOrganizerPayment.findUnique({
    where: { id: paymentId },
    select: { tournamentId: true },
  });
  if (!row) return { ok: false, error: "Payment not found" };

  await db.tournamentOrganizerPayment.delete({ where: { id: paymentId } });
  revalidatePath(`/admin/tournaments/${row.tournamentId}`);
  return { ok: true };
}
