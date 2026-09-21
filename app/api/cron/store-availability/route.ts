import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  fetchLiveAppStoreVersion,
  fetchLivePlayTrack,
  playTrackHasBuild,
} from "@/lib/store-availability";

/**
 * Cron worker — reconcile AppVersionGate against what the stores actually
 * serve, and flip `latestIsLive` when a build becomes downloadable.
 *
 * CI records a freshly-uploaded build with `latestIsLive: false` (see
 * `scripts/set-version-gate.ts`), so the app shows no "update available"
 * prompt while the build sits in App Store review or as a Play draft. This
 * job is what ends that wait without anyone watching for approval.
 *
 * It only ever flips false → true. Demoting a live gate on a failed lookup
 * would silence legitimate update prompts across the whole install base, so
 * an unknown answer changes nothing.
 *
 * Moved here from `.github/workflows/cron-store-availability.yml`, which was
 * the last of the Vercel-Hobby-era GitHub crons. It was the awkward one:
 * unlike the other five it was not a ping, it checked out the repo and ran
 * `scripts/check-store-availability.ts` against the production database, so
 * moving it needed `GOOGLE_PLAY_JSON_KEY` in Vercel's environment first.
 * GitHub was delivering ~6 runs a day against its hourly schedule.
 *
 * `scripts/check-store-availability.ts` is kept for manual dry-runs.
 *
 * `?dry=1` reports what it would flip without writing, for checking the
 * credential works without touching live gates.
 */

// Two external lookups (Apple's lookup API, Google's OAuth + Play API) plus
// a handful of writes. The 60s default is tight when a store API is slow.
export const maxDuration = 120;

async function handle(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = new URL(request.url).searchParams.get("dry") === "1";
  const notes: string[] = [];
  let promoted = 0;

  const gates = await db.appVersionGate.findMany({
    where: { channel: "production", latestIsLive: false },
  });
  if (gates.length === 0) {
    // Logged even though nothing happened. A run that says nothing is
    // indistinguishable from a run that never fired, which is exactly the
    // confusion this route was written to end — the first eight scheduled
    // runs after it shipped produced no output at all, so the schedule was
    // provable from the HTTP log and the Play credential was not provable
    // from anything.
    console.log("[store-availability] gatesAwaiting=0 — nothing to reconcile");
    return NextResponse.json({
      ok: true,
      gatesAwaiting: 0,
      promoted: 0,
      note: "No production gates awaiting store availability.",
    });
  }

  // One Play lookup covers every android gate in this run.
  const needsPlay = gates.some((g) => g.platform === "android");
  const playTrack = needsPlay
    ? await fetchLivePlayTrack(process.env.GOOGLE_PLAY_JSON_KEY)
    : null;

  // SAY SO WHEN THE CREDENTIAL IS THE PROBLEM.
  //
  // `fetchLivePlayTrack` returns null both for "no credential configured"
  // and for "the call failed", and the caller treats both as "leave the gate
  // alone" — which is the right SAFETY behaviour and a terrible diagnostic.
  // A missing GOOGLE_PLAY_JSON_KEY looks exactly like a healthy run with
  // nothing to do, which is precisely how you would fail to notice that an
  // environment variable never landed. The distinction is reported here and
  // logged as a warning.
  const playCredentialPresent = !!process.env.GOOGLE_PLAY_JSON_KEY?.trim();
  const playLookup = !needsPlay
    ? ("not-needed" as const)
    : !playCredentialPresent
      ? ("no-credential" as const)
      : playTrack
        ? ("ok" as const)
        : ("failed" as const);
  if (playLookup === "no-credential") {
    console.warn(
      "[store-availability] GOOGLE_PLAY_JSON_KEY is not set — android gates cannot be reconciled.",
    );
  } else if (playLookup === "failed") {
    console.warn(
      "[store-availability] Play track lookup failed — credential present but the call did not return a track.",
    );
  }

  for (const gate of gates) {
    const label = `${gate.channel}/${gate.platform} build ${gate.latestBuild} (${gate.latestVersionName ?? "?"})`;
    let live = false;
    let evidence = "";

    if (gate.platform === "ios") {
      const storeVersion = await fetchLiveAppStoreVersion();
      if (storeVersion == null) {
        notes.push(`${label}: App Store lookup unavailable — left as-is`);
        continue;
      }
      evidence = `App Store serves ${storeVersion}`;
      // The build number isn't exposed by the lookup API, so the marketing
      // version is the comparison. Versions only ever go forward, so an
      // exact match means our build is the one being served.
      live = !!gate.latestVersionName && storeVersion === gate.latestVersionName;
    } else {
      if (playTrack == null) {
        notes.push(`${label}: Play track lookup unavailable (${playLookup}) — left as-is`);
        continue;
      }
      evidence = `Play production track: codes [${playTrack.liveVersionCodes.join(", ") || "-"}] names [${playTrack.liveVersionNames.join(", ") || "-"}]`;
      live = playTrackHasBuild(playTrack, gate.latestBuild, gate.latestVersionName);
    }

    if (!live) {
      notes.push(`${label}: not live yet — ${evidence}`);
      continue;
    }
    if (dryRun) {
      notes.push(`${label}: WOULD mark live — ${evidence}`);
      promoted++;
      continue;
    }
    await db.appVersionGate.update({
      where: { id: gate.id },
      data: { latestIsLive: true, liveConfirmedAt: new Date() },
    });
    promoted++;
    notes.push(`${label}: LIVE on store — ${evidence}`);
    console.log(`[store-availability] ${label}: LIVE on store — ${evidence}`);
  }

  // One line per run, always. `playLookup` is the field that says whether the
  // Google Play credential actually works: "ok" proves it, "no-credential"
  // says the env var never landed, "failed" says it is present but the call
  // did not return a track. Without this the only evidence of a healthy run
  // is the absence of a warning, which is not evidence.
  console.log(
    `[store-availability] gatesAwaiting=${gates.length} playLookup=${playLookup} promoted=${promoted}${dryRun ? " (dry run)" : ""}` +
      (notes.length ? ` | ${notes.join(" | ")}` : ""),
  );

  return NextResponse.json({
    ok: true,
    dryRun,
    gatesAwaiting: gates.length,
    playLookup,
    promoted,
    notes,
  });
}

export const GET = handle;
export const POST = handle;
