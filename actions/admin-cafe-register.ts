"use server";

import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { readRegisterImage } from "@/lib/cafe-register/vision";
import {
  matchItem,
  normalizePayment,
  normalizeTerm,
  priceMismatch,
  type Alias,
  type MenuItem,
} from "@/lib/cafe-register/match";
import { adminCreateCafeOrder } from "@/actions/admin-cafe-orders";

/**
 * Photograph of the register in, reviewed orders out.
 *
 * Three steps, deliberately separate: transcribe, match, then let a human
 * approve. Nothing is created from a photograph alone — these rows are
 * real money against real tills, and the value of the feature is saving
 * the typing, not skipping the checking.
 *
 * The learning happens on approval. Whatever the admin corrects becomes
 * an alias, so the same shorthand is understood without help next time.
 * There is no separate approval queue for those aliases, unlike the
 * booking bot's learned words: the admin corrected the row on a screen
 * where they were already confirming every line, and that IS the
 * approval. A second one would be ceremony.
 */

const PERMISSION = "MANAGE_CAFE_ORDERS";

export interface ReviewRow {
  rawItem: string;
  cafeItemId: string | null;
  itemName: string | null;
  matchSource: "alias" | "exact" | "fuzzy" | "none";
  qty: number;
  /** As written on the page. Kept beside the menu price, not merged. */
  writtenPrice: number | null;
  time: string | null;
  payment: "CASH" | "UPI_QR" | null;
  /** Set when the written figure disagrees with the menu's own price. */
  priceWarning: { expected: number; written: number } | null;
}

export interface ExtractResult {
  uploadId: string | null;
  rows: ReviewRow[];
  error: string | null;
  /** Rows the rules resolved with no help — the number that should climb. */
  autoMatched: number;
  latencyMs: number;
}

async function menuAndAliases(): Promise<{ menu: MenuItem[]; aliases: Alias[] }> {
  const [items, aliasRows] = await Promise.all([
    db.cafeItem.findMany({
      where: { isAvailable: true },
      select: { id: true, name: true, price: true },
      orderBy: { name: "asc" },
    }),
    db.cafeItemAlias.findMany({ select: { term: true, cafeItemId: true } }),
  ]);
  return { menu: items, aliases: aliasRows };
}

/** The menu, for the review table's per-row dropdown. */
export async function getCafeMenuOptions(): Promise<MenuItem[]> {
  await requireAdmin(PERMISSION);
  return db.cafeItem.findMany({
    where: { isAvailable: true },
    select: { id: true, name: true, price: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
}

/**
 * Transcribe a photographed page and match what it says to the menu.
 *
 * `imageDataUrl` is a data: URL rather than a hosted file — a page of the
 * day's takings should not need to be publicly reachable for a third
 * party to read it, and nothing here needs the image afterwards except
 * the audit row.
 */
export async function extractRegisterImage(
  imageDataUrl: string,
): Promise<ExtractResult> {
  const admin = await requireAdmin(PERMISSION);

  const vision = await readRegisterImage(imageDataUrl);
  const { menu, aliases } = await menuAndAliases();
  const byId = new Map(menu.map((m) => [m.id, m]));

  const rows: ReviewRow[] = vision.rows.map((r) => {
    const m = matchItem(r.item, menu, aliases);
    const qty = r.qty != null && r.qty > 0 ? Math.min(99, Math.round(r.qty)) : 1;
    const item = m.cafeItemId ? (byId.get(m.cafeItemId) ?? null) : null;
    return {
      rawItem: m.rawItem,
      cafeItemId: m.cafeItemId,
      itemName: m.itemName,
      matchSource: m.matchSource,
      qty,
      writtenPrice: r.price,
      time: r.time,
      payment: normalizePayment(r.payment),
      priceWarning: priceMismatch(r.price, qty, item),
    };
  });

  const autoMatched = rows.filter((r) => r.cafeItemId != null).length;

  // Logged before anything is created, so a page that was read and then
  // abandoned is still visible — those are the ones worth looking at.
  const upload = await db.cafeRegisterUpload
    .create({
      data: {
        // The photograph itself is not stored: it is a page of a paper
        // book that stays in the cafe, and keeping copies of it earns
        // nothing. The transcription is the useful part.
        imageUrl: "",
        rawResult: (vision.raw ?? null) as never,
        rowCount: rows.length,
        autoMatchedCount: autoMatched,
        uploadedByAdminId: admin.id,
        error: vision.error,
        latencyMs: vision.latencyMs,
      },
      select: { id: true },
    })
    .catch(() => null);

  return {
    uploadId: upload?.id ?? null,
    rows,
    error: vision.error,
    autoMatched,
    latencyMs: vision.latencyMs,
  };
}

export interface ConfirmRow {
  rawItem: string;
  cafeItemId: string;
  qty: number;
  payment: "CASH" | "UPI_QR";
  /** True when the admin changed the item this row was matched to. */
  corrected: boolean;
}

/**
 * Create the orders the admin approved, and learn from what they changed.
 *
 * One order per row. The register is a running list of individual counter
 * sales, so that is the honest reading of it — grouping rows by time
 * would invent a basket nobody rang up, and the times on the page are the
 * customer's booking slot rather than the moment of sale.
 *
 * Orders go through adminCreateCafeOrder, the same path the walk-in POS
 * uses. Nothing about payments, totals or stock is reimplemented here;
 * this screen only decides WHAT to create.
 */
export async function confirmRegisterOrders(input: {
  uploadId: string | null;
  rows: ConfirmRow[];
}): Promise<{
  success: boolean;
  created: number;
  failed: number;
  learned: number;
  error?: string;
}> {
  const admin = await requireAdmin(PERMISSION);
  const rows = input.rows.filter((r) => r.cafeItemId && r.qty > 0);
  if (rows.length === 0) {
    return { success: false, created: 0, failed: 0, learned: 0, error: "Nothing to create." };
  }

  let created = 0;
  let failed = 0;
  const orderIds: string[] = [];

  for (const row of rows) {
    try {
      const res = await adminCreateCafeOrder({
        items: [{ cafeItemId: row.cafeItemId, quantity: row.qty }],
        paymentMethod: row.payment,
      });
      // Each row is its own order, created one at a time on purpose: a
      // page of twelve sales must not become all-or-nothing, and a single
      // unavailable item should not cost the other eleven.
      if ((res as { success?: boolean })?.success === false) failed++;
      else {
        created++;
        const id = (res as { order?: { id?: string } })?.order?.id;
        if (id) orderIds.push(id);
      }
    } catch {
      failed++;
    }
  }

  // ── Learn ────────────────────────────────────────────────────────
  //
  // Every approved row teaches the shorthand, not just the corrected
  // ones: a row the rules matched by luck is worth pinning down so the
  // next page does not depend on the same luck. Upserting means a
  // shorthand that changes meaning simply gets re-pointed.
  let learned = 0;
  for (const row of rows) {
    const term = normalizeTerm(row.rawItem);
    if (!term) continue;
    try {
      await db.cafeItemAlias.upsert({
        where: { term },
        create: {
          term,
          cafeItemId: row.cafeItemId,
          source: row.corrected ? "admin" : "auto",
          createdBy: admin.id,
        },
        update: {
          cafeItemId: row.cafeItemId,
          seenCount: { increment: 1 },
          ...(row.corrected ? { source: "admin" } : {}),
        },
      });
      learned++;
    } catch {
      // One bad alias must not lose the orders that were already made.
    }
  }

  if (input.uploadId) {
    await db.cafeRegisterUpload
      .update({
        where: { id: input.uploadId },
        data: {
          createdOrderIds: orderIds,
          correctedCount: rows.filter((r) => r.corrected).length,
        },
      })
      .catch(() => null);
  }

  revalidatePath("/admin/cafe-orders");
  revalidatePath("/admin/cafe-register");
  return { success: created > 0, created, failed, learned };
}

export interface AliasRow {
  id: string;
  term: string;
  itemName: string;
  seenCount: number;
  source: string;
}

/** The shorthand the system has been taught, most-used first. */
export async function listCafeAliases(): Promise<AliasRow[]> {
  await requireAdmin(PERMISSION);
  const rows = await db.cafeItemAlias.findMany({
    orderBy: [{ seenCount: "desc" }, { term: "asc" }],
    take: 200,
    select: {
      id: true,
      term: true,
      seenCount: true,
      source: true,
      cafeItem: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    term: r.term,
    itemName: r.cafeItem?.name ?? "(deleted item)",
    seenCount: r.seenCount,
    source: r.source,
  }));
}

/** Forget a mapping. The next page asks about that shorthand again. */
export async function deleteCafeAlias(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin(PERMISSION);
  try {
    await db.cafeItemAlias.delete({ where: { id } });
  } catch {
    return { success: false, error: "Couldn't remove that." };
  }
  revalidatePath("/admin/cafe-register");
  return { success: true };
}
