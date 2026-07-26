"use server";

import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";

/** Recent offer-letter generations, for the audit log on /admin/offer-letter. */
export async function getOfferRecords() {
  await requireAdmin("MANAGE_HR");
  return db.offerLetterRecord.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
