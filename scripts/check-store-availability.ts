/**
 * Reconcile AppVersionGate rows against what the stores actually serve, and
 * flip `latestIsLive` when a build becomes downloadable.
 *
 * CI records a freshly-uploaded build with latestIsLive=false (see
 * scripts/set-version-gate.ts), so the app shows no "update available" prompt
 * while the build sits in App Store review or as a Play draft. This job — run
 * hourly by .github/workflows/cron-store-availability.yml — is what ends that
 * wait without anyone watching.
 *
 *   tsx scripts/check-store-availability.ts [--dry-run]
 *
 * Requires env: DATABASE_URL (+ GOOGLE_PLAY_JSON_KEY for the android half).
 *
 * Only the PRODUCTION channel is reconciled. Development gates map to
 * TestFlight / the Play internal track, where a processed build is available to
 * testers within minutes — set-version-gate marks those live on upload.
 *
 * The job only ever flips false → true. Demoting a live gate on a failed
 * lookup would silence legitimate update prompts across the whole install base,
 * so an unknown answer changes nothing.
 */
import { PrismaClient } from "@prisma/client";
import {
  fetchLiveAppStoreVersion,
  fetchLivePlayTrack,
  playTrackHasBuild,
} from "../lib/store-availability";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const db = new PrismaClient();
  let promoted = 0;
  try {
    const gates = await db.appVersionGate.findMany({
      where: { channel: "production", latestIsLive: false },
    });
    if (gates.length === 0) {
      console.log("No production gates awaiting store availability — nothing to do.");
      return;
    }

    // One Play lookup covers every android gate in this run.
    const playTrack = gates.some((g) => g.platform === "android")
      ? await fetchLivePlayTrack(process.env.GOOGLE_PLAY_JSON_KEY)
      : null;

    for (const gate of gates) {
      const label = `${gate.channel}/${gate.platform} build ${gate.latestBuild} (${gate.latestVersionName ?? "?"})`;
      let live = false;
      let evidence = "";

      if (gate.platform === "ios") {
        const storeVersion = await fetchLiveAppStoreVersion();
        if (storeVersion == null) {
          console.log(`${label}: App Store lookup unavailable — leaving as-is`);
          continue;
        }
        evidence = `App Store serves ${storeVersion}`;
        // The build number isn't exposed by the lookup API, so the marketing
        // version is the comparison. Versions are only ever bumped forward, so
        // an exact match means our build is the one being served.
        live = !!gate.latestVersionName && storeVersion === gate.latestVersionName;
      } else {
        if (playTrack == null) {
          console.log(`${label}: Play track lookup unavailable — leaving as-is`);
          continue;
        }
        evidence = `Play production track: codes [${playTrack.liveVersionCodes.join(", ") || "-"}] names [${playTrack.liveVersionNames.join(", ") || "-"}]`;
        live = playTrackHasBuild(playTrack, gate.latestBuild, gate.latestVersionName);
      }

      if (!live) {
        console.log(`${label}: not live yet — ${evidence}`);
        continue;
      }
      if (dryRun) {
        console.log(`${label}: WOULD mark live — ${evidence}`);
        promoted++;
        continue;
      }
      await db.appVersionGate.update({
        where: { id: gate.id },
        data: { latestIsLive: true, liveConfirmedAt: new Date() },
      });
      promoted++;
      console.log(`✓ ${label}: LIVE on store — ${evidence}`);
    }
  } finally {
    await db.$disconnect();
  }
  console.log(
    promoted > 0
      ? `Marked ${promoted} gate(s) live — update prompts start on the next version-check.`
      : "No gates changed.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
