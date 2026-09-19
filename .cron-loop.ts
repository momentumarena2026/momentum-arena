import { resumeStalledPayments, discardChallengesWhoseHourWent } from "./lib/challenge-payments";
import { sendOfferReminders, expireOffers } from "./lib/challenge-spin";

/**
 * What the per-minute cron would do in production, run for real.
 *
 * `cron-challenge-offers.yml` only ever curls PRODUCTION_URL and GitHub only
 * schedules from the default branch, so this sequence has never executed
 * unattended on staging — and it is the module's money repair: finding
 * stranded captures, telling two captains their hour has gone, nudging and
 * expiring prize offers. Running it on a timer is the closest thing to
 * production short of promoting.
 */
async function tick(n: number) {
  const t0 = Date.now();
  const out: Record<string, number | string> = { tick: n };
  for (const [name, fn] of [
    ["finished", () => resumeStalledPayments(new Date())],
    ["discarded", () => discardChallengesWhoseHourWent(new Date())],
    ["nudged", () => sendOfferReminders(new Date())],
    ["lapsed", () => expireOffers(new Date())],
  ] as const) {
    try {
      out[name] = await fn();
    } catch (e) {
      out[name] = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  out.ms = Date.now() - t0;
  const noisy = Object.entries(out).some(
    ([k, v]) => !["tick", "ms"].includes(k) && v !== 0,
  );
  if (noisy || n % 10 === 0 || Number(out.ms) > 20000) console.log(JSON.stringify(out));
}

async function main() {
  for (let n = 1; n <= 75; n++) {
    await tick(n);
    await new Promise((r) => setTimeout(r, 60_000));
  }
  console.log("cron loop finished 75 ticks");
}
main();
