/**
 * The garland must hang from EVERY customer-facing top nav.
 *
 * ── THE DIVERGENCE THIS GUARDS ────────────────────────────────────────
 * There are two top navs in this product. Most pages use the shared
 * `components/site-header.tsx`; the home page renders its own, inline
 * in `app/page.tsx`. That is not an accident anybody is about to fix —
 * and it has already cost something once, which `app/page.tsx` records
 * in a comment of its own: "The home page renders its own nav rather
 * than SiteHeader, so links added there don't appear here — Camps was
 * missing on this page only."
 *
 * The festive garland is exactly the same shape of change, and it went
 * the same way: hung on SiteHeader first, it rendered on every page
 * except the one everybody actually lands on. This is the check that
 * makes the next one fail loudly instead.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** Every file that renders a customer-facing top nav. */
const NAV_FILES = [
  "components/site-header.tsx",
  "app/page.tsx",
];

/**
 * The app has the same shape of problem for the same reason: its
 * garland hangs from the home screen's own header row, because in the
 * app-wide overlay it landed across the logo.
 */
const APP_NAV_FILES = ["apps/mobile/src/screens/home/HomeScreen.tsx"];

test("every top nav hangs the festive garland", () => {
  for (const file of NAV_FILES) {
    const src = readFileSync(file, "utf8");
    assert.match(
      src,
      /<FestiveGarland\s/,
      `${file} renders a top nav but no <FestiveGarland> — the festive theme ` +
        `would be missing on every page this nav serves. See the note in app/page.tsx ` +
        `about the two navs.`,
    );
    assert.match(
      src,
      /getFestiveTheme/,
      `${file} renders <FestiveGarland> but never resolves a theme to give it`,
    );
  }
});

test("the garland hangs from a positioned nav, or it lands in the wrong place", () => {
  // `absolute top-full` only means "just below the nav" if the nav is a
  // containing block. Without `relative` it would resolve against some
  // ancestor further up and the garland would appear somewhere else
  // entirely — which is the kind of bug that looks like a CSS typo and
  // takes an afternoon.
  const header = readFileSync("components/site-header.tsx", "utf8");
  assert.match(
    header,
    /<nav className="relative /,
    "site-header's <nav> lost its `relative`, so the garland's `absolute top-full` has no anchor",
  );
  const home = readFileSync("app/page.tsx", "utf8");
  assert.match(
    home,
    /<nav className="fixed top-0/,
    "the home nav is no longer fixed at the top; re-check where the garland lands",
  );
});

test("the app hangs its garland from the header too", () => {
  for (const file of APP_NAV_FILES) {
    const src = readFileSync(file, "utf8");
    assert.match(
      src,
      /<FestiveGarland\s*\/>/,
      `${file} lost <FestiveGarland> — the app would show glows and diyas but no toran`,
    );
  }
});

test("the app header does not clip the garland hanging below it", () => {
  // The garland is absolutely positioned at top:"100%" of the header
  // row, so it lives entirely OUTSIDE that row's bounds. Default
  // overflow would clip it away completely and the symptom would be
  // simply nothing rendering, with no error anywhere.
  const src = readFileSync("apps/mobile/src/screens/home/HomeScreen.tsx", "utf8");
  const block = /topNav: \{[\s\S]{0,400}/.exec(src)?.[0] ?? "";
  assert.match(
    block,
    /overflow:\s*"visible"/,
    'HomeScreen topNav lost `overflow: "visible"` — the garland hangs outside it and would be clipped',
  );
});
