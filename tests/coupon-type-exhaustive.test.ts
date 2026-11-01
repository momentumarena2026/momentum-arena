/**
 * Every place that branches on a coupon's TYPE must handle all of them.
 *
 * ── THE BUG THIS EXISTS TO CATCH, WHICH HAPPENED TWICE ────────────────
 * `Coupon.value` means something different per type:
 *
 *   PERCENTAGE    basis points off
 *   FLAT          rupees OFF the order
 *   TARGET_PRICE  the price the customer ENDS UP PAYING, per slot
 *
 * So the usual shape —
 *
 *     if (type === "PERCENTAGE") return `${value / 100}% off`;
 *     return `${formatPrice(value)} off`;        // ← everything else
 *
 * — reads a ₹1,500-an-hour offer as "₹1,500 OFF". On a ₹2,000 slot that
 * is ₹500 instead of ₹1,500: not a rounding error, the OPPOSITE of the
 * offer, and in the admin booking form it was the number the counter
 * reads out loud and collects in cash.
 *
 * TypeScript does not catch it. These are `if/else` chains over string
 * comparisons, not exhaustive switches on a union, so a new enum member
 * silently lands in whatever the final `else` happens to be.
 *
 * It was missed TWICE. The commit that added TARGET_PRICE fixed four
 * surfaces and left two: the web admin create-booking form (reported
 * from production as "opposite effect of diwali coupon") and the
 * customer-facing coupon drawer. The lesson written down at the time was
 * "grep for the OTHER members, not just the one you added" — which is a
 * good intention and not a check. This is the check.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every source file in the surfaces that can render or price a coupon. */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next" || e.startsWith(".")) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(full);
  }
  return out;
}

const ROOTS = ["app", "components", "lib", "actions", "apps/mobile/src"];

/**
 * The legacy `DiscountCode` system shares the `DiscountType` enum but has
 * no slot awareness, so it can never price a TARGET_PRICE row — and
 * `lib/new-user-discount.ts` refuses one outright rather than guessing.
 * Those surfaces are allowed to be two-valued, and are listed by name so
 * the exemption is deliberate rather than a hole.
 */
const LEGACY_DISCOUNT_SURFACES = [
  "app/(admin)/admin/discounts/discount-manager.tsx",
  "app/api/mobile/admin/discounts/route.ts",
  "app/api/mobile/admin/discounts/[id]/route.ts",
  "app/(admin)/admin/cafe-coupons/cafe-coupons-client.tsx",
  "app/api/mobile/admin/cafe-coupons/route.ts",
  "apps/mobile/src/screens/admin/AdminDiscountsScreen.tsx",
  "lib/new-user-discount.ts",
  "app/book/checkout/page.tsx",
  "prisma/seed.ts",
  // Cafe + legacy booking discount codes. All operate on DiscountCode,
  // which has no slot breakdown, and `lib/new-user-discount.ts` already
  // refuses a TARGET_PRICE row rather than pricing one.
  "actions/admin-cafe-discounts.ts",
  "actions/admin-discounts.ts",
  "actions/cafe-orders.ts",
  "actions/discount-validation.ts",
  // The app's new-user label, which reads a DiscountCode like its web twin.
  "apps/mobile/src/screens/book/CheckoutScreen.tsx",
];

test("anything that branches on coupon type accounts for TARGET_PRICE", () => {
  const offenders: string[] = [];

  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const rel = file.replace(/\\/g, "/");
      if (LEGACY_DISCOUNT_SURFACES.includes(rel)) continue;
      const src = readFileSync(file, "utf8");
      // Checked PER BRANCH, not per file. The first version of this test
      // asked only whether the file mentioned TARGET_PRICE anywhere, and
      // a file that handled it in its dropdown LABEL while still getting
      // the MATH wrong sailed through — which is exactly the shape of
      // the bug, two branches in one file disagreeing.
      for (const m of src.matchAll(/===\s*["']PERCENTAGE["']/g)) {
        // The window is the rest of that if/else chain. Generous enough
        // to span a formatted template or a few lines of arithmetic,
        // short enough not to borrow the next function's handling.
        const window = src.slice(m.index!, m.index! + 700);
        // Does this branch go on to treat `value` as money?
        const usesValueAsMoney =
          /format(Price|Rupees)\s*\(\s*[A-Za-z0-9_.]*\.?value/.test(window) ||
          /Math\.min\([^)]*\.value/.test(window) ||
          /=\s*[A-Za-z0-9_.]+\.value\s*;/.test(window);
        if (!usesValueAsMoney) continue;
        if (/TARGET_PRICE/.test(window)) continue;
        offenders.push(`${rel}  (branch at offset ${m.index})`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "These branch on a coupon's type but never mention TARGET_PRICE, so a\n" +
      "target-price coupon falls into their FLAT branch and is read as an\n" +
      "amount OFF — the opposite of the offer:\n\n" +
      offenders.map((f) => `  ${f}`).join("\n") +
      "\n\nEither handle it, or add the file to LEGACY_DISCOUNT_SURFACES with a\n" +
      "reason if it genuinely belongs to the old DiscountCode system.",
  );
});

test("the legacy exemption list is real — a rename cannot empty it", () => {
  // The exemptions are the only way a two-valued branch passes, so a
  // stale path here would silently widen the hole it was meant to narrow.
  for (const f of LEGACY_DISCOUNT_SURFACES) {
    assert.doesNotThrow(
      () => statSync(f),
      `${f} is exempted from the coupon-type check but does not exist — ` +
        `fix the path or drop the entry`,
    );
  }
});
