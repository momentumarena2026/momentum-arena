"use server";

import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";

/**
 * Recent NDA generations, for the audit log on /admin/nda. Read-only:
 * rows carry only who/when + identifying contact and the last 4 of the
 * Aadhaar — never enough to re-produce the PDF (the full Aadhaar is not
 * stored), which is by design.
 */
export async function getNdaRecords() {
  await requireAdmin("MANAGE_HR");
  return db.ndaRecord.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
