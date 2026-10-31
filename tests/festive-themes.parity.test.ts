/**
 * Parity + behaviour suite for the festive theme system.
 *
 * `lib/festive-themes.ts` and `apps/mobile/src/lib/festive-themes.ts` are
 * a mirrored pair: the website and the app each compile their own copy
 * of the palette and the dated windows, because the server sends only a
 * theme ID. CLAUDE.md requires a parity test per pair, in the same
 * commit that creates it.
 *
 * ── WHAT DRIFT WOULD ACTUALLY LOOK LIKE ───────────────────────────────
 * Not a crash. A window edited on one side only means the website turns
 * festive on the 1st and the app on the 6th, for the same festival,
 * with nothing logging it. A colour edited on one side means the two
 * are simply different shades of Diwali. Both are the kind of thing
 * that gets noticed by a customer before it gets noticed by us, which
 * is why the comparison below is over every field and not just the ids.
 *
 * The suite also pins the two properties that are easy to lose:
 * contrast on the black canvas, and the fact that a theme can only
 * appear inside a window somebody typed out by hand.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  FESTIVE_THEMES as web,
  FESTIVE_THEME_IDS as webIds,
  resolveFestiveTheme as webResolve,
  themeForDay as webThemeForDay,
  contrastOnBlack,
} from "../lib/festive-themes";
import {
  FESTIVE_THEMES as mobile,
  FESTIVE_THEME_IDS as mobileIds,
  resolveFestiveTheme as mobileResolve,
  themeForDay as mobileThemeForDay,
} from "../apps/mobile/src/lib/festive-themes";

test("both sides define exactly the same themes, field for field", () => {
  assert.deepEqual(
    [...webIds].sort(),
    [...mobileIds].sort(),
    "a theme exists on one platform and not the other",
  );
  for (const id of webIds) {
    assert.deepEqual(
      mobile[id],
      web[id],
      `the ${id} theme has drifted between web and app — compare lib/festive-themes.ts ` +
        `with apps/mobile/src/lib/festive-themes.ts`,
    );
  }
});

/** Every day either side could be asked about, across both years in play. */
function* everyDay(): Generator<string> {
  for (const year of [2026, 2027]) {
    for (let m = 1; m <= 12; m++) {
      for (let d = 1; d <= 28; d++) {
        yield `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      }
    }
  }
  // Month ends, where an inclusive bound is most likely to be wrong.
  for (const d of ["2026-01-31", "2026-10-31", "2026-11-30", "2026-12-31", "2027-03-31"]) {
    yield d;
  }
}

test("web and app agree on the theme for every day of both years", () => {
  let checked = 0;
  for (const day of everyDay()) {
    assert.equal(
      mobileThemeForDay(day)?.id ?? null,
      webThemeForDay(day)?.id ?? null,
      `divergence on ${day}`,
    );
    checked++;
  }
  assert.ok(checked > 600, `expected a full sweep, only checked ${checked}`);
});

test("web and app agree on every mode and override combination", () => {
  const days = ["2026-10-31", "2026-11-01", "2026-11-11", "2026-11-12", "2026-12-25", "2027-03-21"];
  const modes = ["AUTO", "ON", "OFF", "", null, undefined, "nonsense"];
  const overrides = [null, undefined, "diwali", "christmas", "holi", "easter", ""];
  for (const dayKey of days) {
    for (const mode of modes) {
      for (const override of overrides) {
        const a = webResolve({ mode, override, dayKey })?.id ?? null;
        const b = mobileResolve({ mode, override, dayKey })?.id ?? null;
        assert.equal(b, a, `divergence at ${dayKey} mode=${mode} override=${override}`);
      }
    }
  }
});

test("OFF beats the calendar, always", () => {
  // The kill switch is the one thing an admin reaches for when
  // something looks wrong at 9pm. It must not be conditional.
  for (const dayKey of ["2026-11-05", "2026-12-25", "2027-03-21"]) {
    for (const override of [null, "diwali", "christmas"]) {
      assert.equal(webResolve({ mode: "OFF", override, dayKey }), null);
    }
  }
});

test("ON with no choice falls back to the calendar, not to nothing", () => {
  // What makes "Force on" usable before anybody has picked a theme:
  // it shows whatever is in season rather than silently showing none.
  assert.equal(webResolve({ mode: "ON", override: null, dayKey: "2026-11-05" })?.id, "diwali");
  assert.equal(webResolve({ mode: "ON", override: null, dayKey: "2026-06-01" }), null);
});

test("an unknown mode degrades to AUTO rather than throwing", () => {
  // This is read on the home page of a live venue. A settings row that
  // somehow holds a bad string must give the ordinary site, not a 500.
  for (const mode of ["", "auto", "Auto", "garbage", null, undefined]) {
    assert.doesNotThrow(() => webResolve({ mode, dayKey: "2026-11-05" }));
    assert.equal(webResolve({ mode, dayKey: "2026-11-05" })?.id, "diwali");
  }
});

test("an unknown override is ignored, not rendered", () => {
  // A theme that was renamed or removed must not leave the setting
  // pointing at nothing forever.
  assert.equal(
    webResolve({ mode: "ON", override: "easter", dayKey: "2026-11-05" })?.id,
    "diwali",
    "a bad override should fall through to the calendar",
  );
  assert.equal(webResolve({ mode: "ON", override: "easter", dayKey: "2026-06-01" }), null);
});

test("windows are inclusive at both ends and closed outside", () => {
  // The Diwali skin must cover exactly the days the Diwali OFFER
  // covers — 1–11 Nov, the same bounds as lib/diwali-2026.ts. A skin
  // that outlived the discount would advertise a festival the checkout
  // has stopped honouring.
  assert.equal(webThemeForDay("2026-10-31"), null, "the day before must be plain");
  assert.equal(webThemeForDay("2026-11-01")?.id, "diwali", "first day inclusive");
  assert.equal(webThemeForDay("2026-11-11")?.id, "diwali", "last day inclusive");
  assert.equal(webThemeForDay("2026-11-12"), null, "the day after must be plain");
});

test("a year with no window simply has no theme", () => {
  // The honest failure. Diwali and Holi are lunar and must be typed out
  // per year; a missing year shows the ordinary site rather than
  // guessing a fortnight.
  for (const day of ["2028-11-05", "2030-12-25", "2025-11-05"]) {
    assert.equal(webThemeForDay(day), null, `${day} has no window and must render nothing`);
  }
});

test("no two themes overlap in the same year", () => {
  // `themeForDay` returns the FIRST match, so an overlap would make the
  // winner depend on object key order — the same arbitrary tie-break
  // that put the wrong Navratri line on day one.
  const byYear = new Map<string, { id: string; from: string; to: string }[]>();
  for (const id of webIds) {
    for (const [year, w] of Object.entries(web[id].windows)) {
      const list = byYear.get(year) ?? [];
      list.push({ id, ...w });
      byYear.set(year, list);
    }
  }
  for (const [year, list] of byYear) {
    const sorted = [...list].sort((a, b) => (a.from < b.from ? -1 : 1));
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(
        sorted[i].from > sorted[i - 1].to,
        `in ${year}, ${sorted[i - 1].id} (${sorted[i - 1].from}–${sorted[i - 1].to}) overlaps ` +
          `${sorted[i].id} (${sorted[i].from}–${sorted[i].to})`,
      );
    }
  }
});

test("every window is a real, forward-running date range", () => {
  for (const id of webIds) {
    for (const [year, w] of Object.entries(web[id].windows)) {
      assert.match(w.from, /^\d{4}-\d{2}-\d{2}$/, `${id} ${year} from`);
      assert.match(w.to, /^\d{4}-\d{2}-\d{2}$/, `${id} ${year} to`);
      assert.ok(w.from <= w.to, `${id} ${year} ends before it starts`);
      assert.equal(w.from.slice(0, 4), year, `${id} ${year} window is not in its own year`);
      assert.equal(w.to.slice(0, 4), year, `${id} ${year} window ends in another year`);
    }
  }
});

test("every festive colour clears AA on the black canvas", () => {
  // The failure this prevents is a palette picked in a mock that turns
  // out unreadable outdoors — the exact thing documented against
  // `subtleForeground` in the app's colour file. 4.5:1 is the AA floor
  // for body text; accents are held to it too because they get used on
  // small labels.
  for (const id of webIds) {
    const t = web[id];
    for (const [field, hex] of [
      ["accent", t.accent],
      ["accentSoft", t.accentSoft],
      ["accentText", t.accentText],
    ] as const) {
      const ratio = contrastOnBlack(hex);
      assert.ok(
        ratio >= 4.5,
        `${id}.${field} (${hex}) is ${ratio.toFixed(2)}:1 on black — under the 4.5:1 AA floor`,
      );
    }
  }
});

test("every theme names an app icon key, and they are distinct", () => {
  // The icons are inert until a native build carries them, but the key
  // is the contract between a theme and its asset. Two themes sharing
  // one would silently show the wrong icon for a festival.
  const keys = webIds.map((id) => web[id].iconKey);
  assert.equal(new Set(keys).size, keys.length, `duplicate iconKey among ${keys.join(", ")}`);
  for (const k of keys) assert.match(k, /^[a-z][a-z0-9-]*$/, `${k} is not a safe asset key`);
});

/**
 * The overlay's opacity is the one number that can quietly make the
 * product less readable, and it lives in CSS where no type checker
 * looks. These read the real files.
 */
import { readFileSync } from "node:fs";
import { relativeLuminance } from "../lib/festive-themes";

/** Composite `fg` over `bg` at `alpha`, per simple source-over blending. */
function over(fg: string, bg: string, alpha: number): string {
  const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [fr, fg_, fb] = parse(fg);
  const [br, bg_, bb] = parse(bg);
  const mix = (f: number, b: number) => Math.round(f * alpha + b * (1 - alpha));
  return (
    "#" +
    [mix(fr, br), mix(fg_, bg_), mix(fb, bb)]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}

function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

test("the glow, at the opacity actually shipped, keeps body text above AA", () => {
  // The layer sits OVER the page, so it tints the text and the canvas
  // together. White-on-black starts at 21:1; the question is what the
  // hottest point of the glow leaves. Read from globals.css rather than
  // hardcoded, so raising the opacity there fails HERE rather than on a
  // phone in daylight.
  const css = readFileSync("app/globals.css", "utf8");
  const block = /\.festive-glow\s*\{[\s\S]*?opacity:\s*([\d.]+);/.exec(css);
  assert.ok(block, "could not find .festive-glow's opacity in app/globals.css");
  const alpha = Number(block![1]);
  assert.ok(alpha > 0 && alpha <= 1, `implausible glow opacity ${alpha}`);

  for (const id of webIds) {
    for (const hex of [web[id].accent, web[id].accentSoft]) {
      const text = over(hex, "#ffffff", alpha);
      const canvas = over(hex, "#000000", alpha);
      const ratio = contrast(text, canvas);
      assert.ok(
        ratio >= 4.5,
        `${id}: at glow opacity ${alpha}, white-on-black falls to ${ratio.toFixed(1)}:1 — under AA`,
      );
    }
  }
});

test("the festive layer can never intercept a tap", () => {
  // It spans the whole viewport on both platforms. Without this it
  // would swallow every click on the page underneath — which is the
  // kind of outage a decoration has no business causing.
  const webSrc = readFileSync("components/festive/festive-backdrop.tsx", "utf8");
  assert.match(webSrc, /pointer-events-none/, "the web layer must be pointer-events-none");
  const appSrc = readFileSync(
    "apps/mobile/src/components/festive/FestiveBackdrop.tsx",
    "utf8",
  );
  assert.match(appSrc, /pointerEvents=["']none["']/, "the app layer must set pointerEvents none");
});

test("reduced motion is honoured", () => {
  // Someone who turned animation off should still get the festival,
  // just still. Asserted because a new motif is the easy place to
  // forget it.
  const css = readFileSync("app/globals.css", "utf8");
  const idx = css.indexOf("prefers-reduced-motion");
  assert.ok(idx > -1, "globals.css has no prefers-reduced-motion rule for the festive layer");
  assert.match(
    css.slice(idx, idx + 400),
    /animation:\s*none/,
    "the reduced-motion block must stop the particle animation",
  );
});
