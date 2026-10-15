/**
 * An authed query on a signed-out screen must say so.
 *
 * ── THE BUG THIS EXISTS TO CATCH ──────────────────────────────────────
 * The Challenges card disappeared from the app's home screen for nine
 * days and was reported as "the tile was removed". It had not been. Its
 * query asked an endpoint that needs a token, but was written as
 *
 *     queryKey: ["challenge-home-card"]        // no viewer
 *     queryFn:  () => fetchChallengeBoard(…)   // needs a token
 *     // and no `enabled`
 *
 * Opened signed out it fired anyway, took a 401, and cached that failure
 * under a key that signing in does not change.
 *
 * ── WHY A 401 IS FOREVER HERE, NOT FOR A MOMENT ───────────────────────
 * Two deliberate settings in src/lib/queryClient.ts compound it:
 *
 *     retry: … if (status >= 400 && status < 500) return false
 *     refetchOnWindowFocus: false
 *
 * A 401 is a 4xx, so it is never retried — correct on its own terms,
 * "they're deterministic". With focus-refetch off and the home screen
 * permanently mounted inside the tab navigator, nothing revives it. One
 * 401 while signed out removes the feature for the whole session, and
 * the only symptom is absence: no error card, no skeleton, no log. It
 * looks exactly like somebody deleted the feature.
 *
 * ── WHAT THIS CHECKS, AND WHY ONLY THESE FILES ────────────────────────
 * The failure needs three things at once: the screen must be reachable
 * while signed out, it must stay mounted while the user signs in, and
 * the query must be ungated. Everywhere else is already protected —
 * screens behind the Account wall or the admin shell are never rendered
 * signed out, and for a session that merely EXPIRES, AuthProvider's 401
 * handler drops to signed-out and routes through Phone/OTP, so the
 * screen remounts and refetches on the way back.
 *
 * So this guards the short list of surfaces where all three can line up,
 * rather than all 160 useQuery calls in the app. A wider net would be
 * mostly false positives, and a guard that cries wolf gets deleted.
 *
 * On those surfaces every query must be ONE of:
 *   PUBLIC  its lib call passes `auth: false`
 *   GATED   it has an `enabled` (so it does not run signed out)
 *   KEYED   the viewer is in the queryKey (so signing in refetches)
 *
 * Adding a sport, a card or a banner to the home screen is routine.
 * Adding one that quietly needs a token is the thing nobody notices.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const APP = "apps/mobile";

/**
 * Screens a signed-out person can be looking at, which stay mounted
 * while they sign in. Home is the obvious one; the components listed
 * with it render inside it and never unmount either.
 *
 * Keep this list honest rather than long. If a new always-on surface
 * appears, add it — the test asserts every path here still exists, so a
 * rename cannot quietly empty the net.
 */
const SIGNED_OUT_SURFACES = [
  "src/screens/home/HomeScreen.tsx",
  "src/components/promo/PromoBannerSlot.tsx",
  "src/components/RewardsChip.tsx",
  "src/components/RainBanner.tsx",
  "src/navigation/MomentumTabBar.tsx",
  // The booking flow shows "Sign in to continue" in place — the person
  // signs in without the screen going anywhere.
  "src/screens/book/BookSlotsScreen.tsx",
  "src/screens/book/BookCourtScreen.tsx",
  "src/screens/book/BookSportScreen.tsx",
];

/** Every lib source, concatenated — used to resolve a queryFn to its call. */
function libSource(): string {
  const dir = join(APP, "src/lib");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
}

/**
 * Does this function reach the API with `auth: false`?
 *
 * Looks at the body following the definition. Deliberately generous:
 * the question is "did somebody mark this public on purpose", and a
 * false NEGATIVE here only means the author must add `enabled`, which
 * is never wrong. A false POSITIVE would hide a real case, so the
 * window is kept tight.
 */
function isPublicCall(lib: string, fnPath: string): boolean {
  const leaf = fnPath.split(".").pop()!;
  const defs = [
    new RegExp(`\\b${leaf}\\s*:\\s*\\(`, "g"),
    new RegExp(`function\\s+${leaf}\\s*\\(`, "g"),
    new RegExp(`\\b${leaf}\\s*=\\s*\\(`, "g"),
  ];
  for (const re of defs) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(lib))) {
      // 1500 rather than 500: a call site may carry a real doc comment
      // between the signature and the options object, and the first
      // version of this test missed an `auth: false` for exactly that
      // reason — it read its own explanatory comment as the body.
      if (lib.slice(m.index, m.index + 1500).includes("auth: false")) return true;
    }
  }
  return false;
}

interface Found {
  file: string;
  key: string;
  fn: string;
  gated: boolean;
  keyed: boolean;
}

/**
 * Every lib call a queryFn reaches.
 *
 * Not "the first identifier after queryFn:" — that was the first
 * version and it misread two perfectly good queries, because a
 * `queryKey` can be a ternary and a `queryFn` can span lines and
 * branch:
 *
 *     queryKey: isMedium ? [...] : [...],
 *     queryFn: () =>
 *       isMedium ? bookingApi.availability({…}) : bookingApi.availability({…}),
 *
 * It reported `isMedium` as the function and flagged it. A guard that
 * cries wolf gets deleted, so this collects every call in the queryFn
 * region and asks whether ALL of them are public — a query is only safe
 * if every branch is.
 */
function callsInQueryFn(blk: string): string[] {
  const at = blk.indexOf("queryFn:");
  if (at === -1) return [];
  const region = blk.slice(at);

  // `queryFn: fetchTournamentHub,` — a bare reference, no call parens.
  // Missing this form made the scanner walk past the end of the options
  // object and pick up the NEXT useQuery as the function name.
  const bare = /^queryFn:\s*([A-Za-z0-9_.]+)\s*,/.exec(region);
  if (bare) return [bare[1]];
  const names = new Set<string>();
  for (const m of region.matchAll(/\b([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)?)\s*\(/g)) {
    const n = m[1];
    // Language/stdlib noise, not our API surface.
    if (/^(if|for|while|switch|return|typeof|await|Number|String|Boolean|Array|Object|JSON|Promise|Math|Date)\b/.test(n)) continue;
    names.add(n);
  }
  return [...names];
}

function queriesIn(file: string): Found[] {
  const src = readFileSync(join(APP, file), "utf8");
  const out: Found[] = [];
  for (const m of src.matchAll(/useQuery\(\{/g)) {
    // A bounded window; long enough for the options object, short
    // enough not to swallow the next call.
    const next = src.indexOf("useQuery({", m.index! + 1);
    const end = next === -1 ? m.index! + 900 : Math.min(next, m.index! + 900);
    const blk = src.slice(m.index!, end);
    // The key may be a ternary spanning lines, so take everything up to
    // the next option rather than assuming a single bracket group.
    const rawKey = /queryKey:\s*([\s\S]*?)(?=\n\s*(?:queryFn|enabled|staleTime|gcTime|retry|select|refetch)\s*[:,])/.exec(blk)?.[1] ?? "";
    out.push({
      file,
      key: rawKey.replace(/\s+/g, " ").trim().slice(0, 90),
      fn: callsInQueryFn(blk).join(", "),
      // `enabled,` (shorthand) and `enabled: expr` both count.
      gated: /\n\s*enabled\s*(,|:)/.test(blk),
      keyed: /signedIn|user|viewer/i.test(rawKey),
    });
  }
  return out;
}

test("the surface list is real — a rename cannot empty the net", () => {
  for (const f of SIGNED_OUT_SURFACES) {
    assert.ok(
      existsSync(join(APP, f)),
      `${f} is listed as a signed-out surface but does not exist — the guard is checking nothing. Fix the path or drop the entry.`,
    );
  }
});

test("every query on a signed-out surface is public, gated, or viewer-keyed", () => {
  const lib = libSource();
  const offenders: string[] = [];

  for (const file of SIGNED_OUT_SURFACES) {
    for (const q of queriesIn(file)) {
      if (q.gated || q.keyed) continue;
      const calls = q.fn ? q.fn.split(", ").filter(Boolean) : [];
      // Safe only if we resolved at least one call AND every one of them
      // is marked public. Resolving none means the parser lost the
      // thread, which fails closed on purpose.
      const resolved = calls.filter((c) => isPublicCall(lib, c));
      if (calls.length > 0 && resolved.length === calls.length) continue;
      // A branchy queryFn also mentions helpers that are not API calls
      // at all (`isMedium(...)`). Treat it as safe when every call that
      // LOOKS like an API call is public.
      const apiish = calls.filter((c) => /Api\.|^fetch[A-Z]/.test(c));
      if (apiish.length > 0 && apiish.every((c) => isPublicCall(lib, c))) continue;
      offenders.push(
        `${file}\n      queryKey ${q.key || "(unparsed)"}\n      queryFn  ${q.fn || "(unparsed)"}`,
      );
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "These run on a screen a signed-out person can see, and nothing says they may.\n\n" +
      offenders.join("\n\n") +
      "\n\nPick one:\n" +
      "  · the endpoint is public  → pass `{ auth: false }` on the lib call\n" +
      "  · it needs a token        → add `enabled: signedIn`\n" +
      "  · it is per-person        → put the viewer in the queryKey\n\n" +
      "Doing none of them means a 401 while signed out, which queryClient.ts\n" +
      "never retries, so the feature silently stays gone for the session.",
  );
});

test("the home challenge card specifically stays gated", () => {
  // The original. Pinned by name because it is the one that already
  // cost nine days, and a refactor that drops the gate would otherwise
  // only be caught by the general rule above — which somebody could
  // satisfy by moving the query somewhere unlisted.
  const src = readFileSync(
    join(APP, "src/screens/home/HomeScreen.tsx"),
    "utf8",
  );
  const blk = /useQuery\(\{[^}]*challenge-home-card[\s\S]{0,400}/.exec(src)?.[0];
  assert.ok(blk, "the challenge-home-card query is gone from HomeScreen");
  assert.match(
    blk!,
    /enabled:\s*signedIn/,
    "challenge-home-card lost `enabled: signedIn` — it will 401 for signed-out users and stay hidden all session",
  );
  assert.match(
    blk!,
    /queryKey:\s*\["challenge-home-card",\s*signedIn\]/,
    "challenge-home-card lost the viewer from its key — signing in will not refetch it",
  );
});

test("the amplifier is still what it is, so the rule still matters", () => {
  // If somebody ever makes 4xx retryable or turns focus-refetch on, a
  // missing gate stops being permanent and this guard could be relaxed.
  // Until then it must not be, and this is where that argument happens.
  const qc = readFileSync(join(APP, "src/lib/queryClient.ts"), "utf8");
  assert.match(
    qc,
    /status\s*>=\s*400\s*&&\s*status\s*<\s*500[\s\S]{0,80}return false/,
    "queryClient no longer refuses to retry 4xx — re-read tests/app-authed-queries.test.ts, the premise may have changed",
  );
  assert.match(
    qc,
    /refetchOnWindowFocus:\s*false/,
    "queryClient now refetches on focus — a 401 may no longer be permanent; re-check this guard's premise",
  );
});
