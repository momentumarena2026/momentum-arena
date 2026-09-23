/**
 * The admin challenge preview must keep BEING the app, not describing it.
 *
 * The venue asked for a preview that cannot fall behind the app screen, and
 * the only version of that which actually holds is one where there is
 * nothing separate to fall behind: the preview imports `apps/mobile`'s real
 * component and calls the same payload builder the phone's API calls.
 *
 * That property is invisible. Somebody hitting a bundler problem in six
 * months can "fix" it in ten minutes by pasting a copy of the screen into
 * the admin, and every test would still pass while the guarantee quietly
 * died. These assertions are what fail instead.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const PREVIEW_CLIENT = "app/(admin)/admin/challenges/[id]/preview/preview-client.tsx";
const PREVIEW_PAGE = "app/(admin)/admin/challenges/[id]/preview/page.tsx";
const MOBILE_ROUTE = "app/api/mobile/challenges/route.ts";
const NEXT_CONFIG = "next.config.ts";
const APP_SCREEN = "apps/mobile/src/screens/challenges/ChallengeDetailScreen.tsx";

const read = (p: string) => readFileSync(p, "utf8");

test("the preview renders the app's screen, not a copy of it", () => {
  const client = read(PREVIEW_CLIENT);
  assert.match(
    client,
    /from "@preview\/challenge-screen"/,
    "the preview must import the app's screen through the @preview boundary",
  );
  // A local component named like the screen is the shape a fork would take.
  assert.doesNotMatch(
    client,
    /function ChallengeDetailScreen/,
    "the preview has grown its own ChallengeDetailScreen — that is a fork, and the preview stops tracking the app the moment it exists",
  );
});

test("the @preview alias points at the real app file, and that file is there", () => {
  const config = read(NEXT_CONFIG);
  assert.match(
    config,
    /"@preview\/challenge-screen":\s*\n?\s*"\.\/apps\/mobile\/src\/screens\/challenges\/ChallengeDetailScreen\.tsx"/,
    "the @preview/challenge-screen alias must resolve to apps/mobile's own screen",
  );
  assert.ok(
    existsSync(APP_SCREEN),
    `${APP_SCREEN} has moved — the preview alias in next.config.ts points at nothing, and the admin build will fail`,
  );
});

test("the preview and the phone are handed the SAME payload", () => {
  // Two builders answering "what does the app get for this challenge" is
  // exactly how a preview stops being a preview — it would still look
  // right, and be wrong about the one thing somebody opened it to check.
  for (const file of [PREVIEW_PAGE, MOBILE_ROUTE]) {
    assert.match(
      read(file),
      /challengeDetailPayload/,
      `${file} must go through challengeDetailPayload, not build its own payload`,
    );
  }
});

test("an admin looking at a preview is not logged as a customer viewing it", () => {
  // DETAIL_VIEWED drives the funnel that says whether the board is being
  // used at all. Counting the venue's own inspections would inflate the one
  // number nobody would think to distrust.
  assert.match(
    read(PREVIEW_PAGE),
    /track:\s*false/,
    "the preview must pass track:false, or admin views land in the customer funnel",
  );
});

test("every native shim is named where somebody will find it", () => {
  // The preview runs the app's code against web stand-ins for native
  // modules. Each one is a place the preview could differ from a phone, so
  // the set has to stay small and visible rather than growing quietly.
  const config = read(NEXT_CONFIG);
  const aliased = [...config.matchAll(/"([^"]+)":\s*\n?\s*"\.\/lib\/rn-web-stubs\/[^"]+"/g)].map(
    (m) => m[1],
  );
  assert.ok(aliased.length > 0, "expected the rn-web-stubs aliases to be present");
  for (const spec of aliased) {
    assert.ok(
      config.includes(spec),
      `${spec} is stubbed for the web but not listed in next.config.ts`,
    );
  }
  // The app-side platform shims are the other half, and are easy to delete
  // by accident because nothing on a phone imports them.
  for (const f of [
    "apps/mobile/src/providers/AuthProvider.web.tsx",
    "apps/mobile/src/lib/storage.web.ts",
  ]) {
    assert.ok(
      existsSync(f),
      `${f} is gone — the preview will drag the native keychain/MMKV/Firebase chain into the web bundle and the admin build will fail`,
    );
  }
});
