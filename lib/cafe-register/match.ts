/**
 * Turning a line of the cafe register into a menu item.
 *
 * The register is written in a shorthand the counter staff share and
 * nobody wrote down: "W.B (F)", "Sprite (P)", "Sticks Chips (P)". The
 * right response to that is not to decode it — a guess at what "(P)"
 * means would be confidently wrong on some rows forever — but to be
 * TOLD, once, and remember.
 *
 * So the order is: what we have been told, then what is obvious, then
 * ask. Aliases first, exact name, then bounded fuzzy matching, and
 * anything left over is handed to the admin as an unmatched row rather
 * than guessed at. A wrong match here becomes a real order for the wrong
 * item at the wrong price, so refusing to answer is cheap and guessing
 * is not.
 *
 * Pure: no database, no network. The caller supplies the menu and the
 * aliases, which is what makes every rule below testable.
 */

import { editDistance } from "@/lib/booking-bot/fuzzy";

export type MenuItem = { id: string; name: string; price: number };
export type Alias = { term: string; cafeItemId: string };

/** How the match was made — shown to the admin, who deserves to know. */
export type MatchSource = "alias" | "exact" | "fuzzy" | "none";

export type MatchedRow = {
  /** The text as the model read it, kept verbatim for the audit trail. */
  rawItem: string;
  cafeItemId: string | null;
  itemName: string | null;
  matchSource: MatchSource;
  /** Distance for a fuzzy hit, so a reviewer can see how close it was. */
  distance?: number;
};

/**
 * Normalised form used for every comparison and as the alias key.
 *
 * Case, punctuation and spacing vary from page to page in handwriting
 * and OCR; none of them change what an item is. Bracketed suffixes are
 * KEPT — "(P)" may well be the difference between two products, and
 * dropping it would silently merge them.
 */
export function normalizeTerm(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9()]+/g, " ")
      // Brackets get their own spacing before the collapse, so "w.b(f)"
      // and "W.B (F)" reach the same key. Without this the alias stored
      // from one page misses the same shorthand written slightly tighter
      // on the next — and the admin would be re-teaching the same word.
      .replace(/\(/g, " (")
      .replace(/\)/g, ") ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * How wrong a name may be and still match, by length.
 *
 * Deliberately tighter than the booking bot's: there the cost of a wrong
 * fuzzy match is one extra tap, and here it is an order for the wrong
 * item at the wrong price. Short names get no latitude at all, because
 * "Coke" and "Cake" are one edit apart and both plausible on a menu.
 */
function budgetFor(term: string): number {
  if (term.length <= 5) return 0;
  if (term.length <= 9) return 1;
  return 2;
}

/**
 * Resolve one written line to a menu item.
 *
 * A tie returns nothing. Two items equally close means we do not know
 * which, and on a screen that creates orders "I don't know" is a far
 * better answer than a coin flip — the admin picks in one tap and the
 * choice is remembered.
 */
export function matchItem(
  rawItem: string,
  menu: MenuItem[],
  aliases: Alias[],
): MatchedRow {
  const term = normalizeTerm(rawItem);
  const base: MatchedRow = {
    rawItem,
    cafeItemId: null,
    itemName: null,
    matchSource: "none",
  };
  if (!term) return base;

  const byId = new Map(menu.map((m) => [m.id, m]));

  // 1. What we have been told. Beats everything, including a closer
  //    spelling — an alias is a human decision and must not be
  //    second-guessed by arithmetic.
  const alias = aliases.find((a) => normalizeTerm(a.term) === term);
  if (alias) {
    const item = byId.get(alias.cafeItemId);
    if (item) {
      return { ...base, cafeItemId: item.id, itemName: item.name, matchSource: "alias" };
    }
    // The alias points at a deleted item. Fall through rather than
    // returning a match with no item behind it.
  }

  // 2. The item's own name.
  const exact = menu.find((m) => normalizeTerm(m.name) === term);
  if (exact) {
    return { ...base, cafeItemId: exact.id, itemName: exact.name, matchSource: "exact" };
  }

  // 3. Close enough, and unambiguously so.
  const max = budgetFor(term);
  if (max === 0) return base;

  let best: MenuItem | null = null;
  let bestD = max + 1;
  let tied = false;
  for (const m of menu) {
    const d = editDistance(term, normalizeTerm(m.name), max);
    if (d > max) continue;
    if (d < bestD) {
      bestD = d;
      best = m;
      tied = false;
    } else if (d === bestD) {
      tied = true;
    }
  }
  if (!best || tied) return base;

  return {
    ...base,
    cafeItemId: best.id,
    itemName: best.name,
    matchSource: "fuzzy",
    distance: bestD,
  };
}

/**
 * A payment method as the register records it.
 *
 * The page has two tick columns, Online and Cash, and a row ticks one.
 * Anything else — both ticked, neither, an unreadable mark — is left
 * null so the admin decides, because a payment method is not something
 * to infer from an ambiguous pen stroke.
 */
export function normalizePayment(raw: unknown): "CASH" | "UPI_QR" | null {
  const v = String(raw ?? "").toLowerCase().trim();
  if (v === "cash") return "CASH";
  if (v === "online" || v === "upi" || v === "upi_qr") return "UPI_QR";
  return null;
}

/**
 * Does the money add up?
 *
 * The register carries a written price per line, and the menu carries
 * its own. They disagree when a price has changed since the page was
 * written, when the staff gave a discount, or when a digit was misread —
 * and the three need different responses, so this only reports the
 * discrepancy rather than picking a winner.
 */
export function priceMismatch(
  writtenPrice: number | null,
  qty: number,
  item: MenuItem | null,
): { expected: number; written: number } | null {
  if (!item || writtenPrice == null || !Number.isFinite(writtenPrice)) return null;
  const expected = item.price * Math.max(1, qty);
  if (Math.abs(expected - writtenPrice) < 0.5) return null;
  return { expected, written: writtenPrice };
}
