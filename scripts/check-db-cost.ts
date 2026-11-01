/**
 * Gate: nothing reaches main that quietly raises the database bill.
 *
 * Neon bills COMPUTE TIME. A scheduled job that runs more often than the
 * compute's suspend window pins the database awake 24/7 whether or not
 * it finds any work — which is exactly what doubled the bill in October
 * 2026, from a change that looked small and was correct on its own
 * terms. `docs/NEON-COMPUTE-COST.md` has the diagnosis.
 *
 * This compares the cron schedule's cost against a COMMITTED baseline,
 * the same way the mobile typecheck is held to its 15 errors. Going up
 * is a failure. Going up ON PURPOSE means editing
 * `.github/db-cost-baseline.json` in the same commit, with a reason and
 * a name on it — which is the approval, recorded in the repo rather
 * than in somebody's memory.
 *
 *   npx tsx scripts/check-db-cost.ts
 *   npx tsx scripts/check-db-cost.ts --json
 */
import { readFileSync } from "node:fs";
import { cronCost, DEFAULT_SUSPEND_SECONDS, type CronEntry } from "../lib/db-cost";

const BASELINE_PATH = ".github/db-cost-baseline.json";

interface Baseline {
  awakeMinutesPerDay: number;
  allowAlwaysOnCrons: string[];
  approvedBy: string;
  reviewedOn: string;
  reason: string;
}

function fail(lines: string[]): never {
  console.error("\n" + lines.join("\n") + "\n");
  process.exit(1);
}

function main() {
  const crons: CronEntry[] = JSON.parse(readFileSync("vercel.json", "utf8")).crons ?? [];
  const baseline: Baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));

  for (const field of ["approvedBy", "reviewedOn", "reason"] as const) {
    if (!String(baseline[field] ?? "").trim()) {
      fail([
        `${BASELINE_PATH} has an empty \`${field}\`.`,
        "",
        "The baseline is an approval record, not just a number. Whoever raises",
        "it says who they are, when, and why — otherwise the next person has no",
        "way to tell a considered decision from a rubber stamp.",
      ]);
    }
  }

  const report = cronCost(crons, DEFAULT_SUSPEND_SECONDS);

  console.log("Database cost — scheduled work only\n");
  console.log(`  cron entries .............. ${crons.length}`);
  console.log(`  invocations / day ......... ${report.invocationsPerDay}`);
  console.log(`  compute wakes / day ....... ${report.wakeEventsPerDay}`);
  console.log(`  AWAKE MINUTES / DAY ....... ${report.awakeMinutesPerDay}  (baseline ${baseline.awakeMinutesPerDay})`);
  console.log(`  that is .................... ${(report.uptimeFraction * 100).toFixed(1)}% of the day`);
  console.log(`  ~CU-hours / month ......... ${report.cuHoursPerMonth}  (at Neon's 0.25 CU floor)\n`);

  // ── The pathological shape, called out regardless of the number ────
  // A cadence tighter than the suspend window can never let the compute
  // go. It is worth failing on its own terms even if the total happens
  // to sit under the baseline, because it is the specific thing that
  // caused the incident and it is never accidental.
  const unapproved = report.alwaysOn.filter(
    (p) => !baseline.allowAlwaysOnCrons.includes(p),
  );
  if (unapproved.length > 0) {
    fail([
      "✗ DATABASE COST GATE — a cron would keep the database permanently awake",
      "",
      "These fire more often than the compute's suspend window, so the idle",
      "timer never elapses and the database never sleeps:",
      "",
      ...unapproved.map((p) => `    ${p}`),
      "",
      "That is what took the Neon bill from under $20 to about $40 in October.",
      "It costs the same whether the job finds work or not — one of the two",
      "that did it was querying a table that has never held a row.",
      "",
      "If this is deliberate and the latency is worth the money, add the path",
      `to \`allowAlwaysOnCrons\` in ${BASELINE_PATH} with the reason, and raise`,
      "`awakeMinutesPerDay` to match. docs/NEON-COMPUTE-COST.md has the sums.",
    ]);
  }

  if (report.awakeMinutesPerDay > baseline.awakeMinutesPerDay) {
    const extra = report.awakeMinutesPerDay - baseline.awakeMinutesPerDay;
    const extraCu = ((extra / 60) * 0.25 * 30).toFixed(1);
    fail([
      "✗ DATABASE COST GATE — this change makes the database stay awake longer",
      "",
      `    baseline   ${baseline.awakeMinutesPerDay} min/day`,
      `    this       ${report.awakeMinutesPerDay} min/day   (+${extra})`,
      `    roughly    +${extraCu} CU-hours a month, before any real traffic`,
      "",
      "Neon bills compute TIME, not queries, so spreading jobs across more",
      "minutes costs more than running them together — four crons on four",
      "different minutes buy four awake windows an hour; the same four on one",
      "minute buy one.",
      "",
      "If you want this, it needs approving on purpose: set",
      `\`awakeMinutesPerDay\` to ${report.awakeMinutesPerDay} in ${BASELINE_PATH},`,
      "in this commit, with your name and the reason. That edit IS the approval.",
      "",
      "If you don't: move the new job onto :30 with everything else, or give it",
      "a cadence wider than 5 minutes.",
    ]);
  }

  if (report.awakeMinutesPerDay < baseline.awakeMinutesPerDay) {
    console.log(
      `↓ This is ${baseline.awakeMinutesPerDay - report.awakeMinutesPerDay} min/day CHEAPER than the baseline.\n` +
        `  Ratchet \`awakeMinutesPerDay\` down to ${report.awakeMinutesPerDay} in ${BASELINE_PATH}\n` +
        `  so the saving is locked in and cannot be given back silently.\n`,
    );
  }

  console.log(`✓ within the approved baseline (${baseline.approvedBy}, ${baseline.reviewedOn})`);
}

main();
