/**
 * Is push working? Answer it with evidence rather than a shrug.
 *
 * Written after a real customer posted a challenge on production and
 * nobody heard about it. Two very different things look identical from
 * the outside — "the pipeline is broken" and "nothing ever sends a push
 * for that event" — and until you can tell them apart you are guessing.
 * This prints the facts for both:
 *
 *   FLEET     how many devices could be reached at all, by platform, and
 *             how many have gone quiet (uninstall / signed out elsewhere).
 *   DISPATCH  every push actually SENT, from `PushDispatch` — the
 *             per-send log lib/push.ts writes. attempted/succeeded/failed
 *             is the delivery rate. A healthy pipeline with zero rows for
 *             a given kind means that kind is never sent, which is a
 *             product gap, not an outage.
 *   INBOX     `UserNotification` rows, which are written on the same path
 *             as a customer push. Rows here with no matching dispatch mean
 *             the in-app write survived and the FCM send did not.
 *   CHALLENGES what the board actually did — posts, accepts, payments —
 *             next to what it notified, so a silent event is visible as a
 *             gap between the two columns rather than inferred.
 *
 * Read-only. Runs no sends, writes nothing, touches no token values (a
 * token is a credential; only counts and the last four characters ever
 * appear here).
 *
 * DAYS   how far back to look (default 14).
 */

import { db } from "../lib/db";

const DAYS = Number(process.env.DAYS ?? 14) || 14;
const since = new Date(Date.now() - DAYS * 86400_000);

function pct(n: number, d: number): string {
  if (d <= 0) return "   — ";
  return `${((n / d) * 100).toFixed(1).padStart(5)}%`;
}

function ago(d: Date | null | undefined): string {
  if (!d) return "never";
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

function head(title: string) {
  console.log("");
  console.log(`── ${title} ${"─".repeat(Math.max(0, 62 - title.length))}`);
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/?]+)/)?.[1] ?? "unknown";
  console.log(`database host: ${host}`);
  console.log(`window: last ${DAYS} days (since ${since.toISOString()})`);

  /* ── 1. Can we reach anybody at all? ─────────────────────────── */
  head("FLEET — devices that could receive a push");

  const [devices, adminDevices] = await Promise.all([
    db.pushDevice.findMany({ select: { platform: true, lastSeenAt: true, appVersion: true } }),
    db.adminPushDevice.findMany({ select: { platform: true, lastSeenAt: true } }),
  ]);

  const stale = new Date(Date.now() - 30 * 86400_000);
  for (const [label, rows] of [
    ["customer", devices],
    ["admin", adminDevices],
  ] as const) {
    const ios = rows.filter((d) => d.platform === "ios").length;
    const android = rows.filter((d) => d.platform === "android").length;
    const quiet = rows.filter((d) => d.lastSeenAt < stale).length;
    console.log(
      `   ${label.padEnd(9)} ${String(rows.length).padStart(4)} devices` +
        `   ios ${String(ios).padStart(4)}   android ${String(android).padStart(4)}` +
        `   quiet >30d ${String(quiet).padStart(4)}`,
    );
  }
  if (devices.length === 0) {
    console.log("   ⚠ No customer devices registered — every push is a no-op.");
  }

  // Which app builds are out there. A fix that shipped in a build nobody
  // is running is indistinguishable from a fix that does not work.
  const byVersion = new Map<string, number>();
  for (const d of devices) byVersion.set(d.appVersion ?? "unknown", (byVersion.get(d.appVersion ?? "unknown") ?? 0) + 1);
  const versions = [...byVersion.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (versions.length) {
    console.log(`   app versions: ${versions.map(([v, n]) => `${v}×${n}`).join("  ")}`);
  }

  /* ── 2. What actually went out? ──────────────────────────────── */
  head(`DISPATCH — pushes SENT in the last ${DAYS} days`);

  const dispatches = await db.pushDispatch.groupBy({
    by: ["kind", "source"],
    where: { createdAt: { gte: since } },
    _sum: { attempted: true, succeeded: true, failed: true, cleanedUp: true },
    _count: { _all: true },
    orderBy: { _count: { id: "desc" } },
  });

  if (dispatches.length === 0) {
    console.log("   ⚠ NOTHING. No push of any kind has been dispatched in this window.");
    console.log("     Either nothing happened that sends one, or the send path is failing");
    console.log("     before it can log — check for FCM credential errors in the app logs.");
  } else {
    console.log(
      "   kind / source".padEnd(40) +
        "sends".padStart(7) +
        "tried".padStart(8) +
        "ok".padStart(8) +
        "failed".padStart(8) +
        "  rate",
    );
    let tTried = 0;
    let tOk = 0;
    for (const d of dispatches) {
      const tried = d._sum.attempted ?? 0;
      const ok = d._sum.succeeded ?? 0;
      const failed = d._sum.failed ?? 0;
      tTried += tried;
      tOk += ok;
      console.log(
        `   ${`${d.kind} / ${d.source}`.padEnd(37)}` +
          String(d._count._all).padStart(7) +
          String(tried).padStart(8) +
          String(ok).padStart(8) +
          String(failed).padStart(8) +
          "  " +
          pct(ok, tried),
      );
    }
    console.log(`   ${"".padEnd(37)}${"".padStart(7)}${String(tTried).padStart(8)}${String(tOk).padStart(8)}${"".padStart(8)}  ${pct(tOk, tTried)} overall`);
  }

  const lastDispatch = await db.pushDispatch.findFirst({
    orderBy: { createdAt: "desc" },
    select: { kind: true, title: true, createdAt: true, succeeded: true, attempted: true },
  });
  console.log(
    `   most recent send: ${lastDispatch ? `${ago(lastDispatch.createdAt)} — ${lastDispatch.kind} "${lastDispatch.title}" (${lastDispatch.succeeded}/${lastDispatch.attempted})` : "none on record"}`,
  );

  /* ── 3. The in-app side of the same path ─────────────────────── */
  head(`INBOX — in-app notification rows in the last ${DAYS} days`);

  const inbox = await db.userNotification.groupBy({
    by: ["type"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    orderBy: { _count: { id: "desc" } },
  });
  if (inbox.length === 0) {
    console.log("   none");
  } else {
    for (const r of inbox) console.log(`   ${r.type.padEnd(37)}${String(r._count._all).padStart(7)}`);
  }

  /* ── 4. The board, event by event ────────────────────────────── */
  head(`CHALLENGES — what the board did in the last ${DAYS} days`);

  const events = await db.challengeEvent.groupBy({
    by: ["type"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    orderBy: { _count: { id: "desc" } },
  });
  if (events.length === 0) {
    console.log("   no challenge activity at all in this window");
  } else {
    for (const e of events) console.log(`   ${e.type.padEnd(37)}${String(e._count._all).padStart(7)}`);
  }

  const posted = await db.challenge.findMany({
    where: { createdAt: { gte: since } },
    select: {
      id: true,
      teamName: true,
      sport: true,
      status: true,
      createdAt: true,
      createdByUserId: true,
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  console.log("");
  console.log(`   ${posted.length} challenge(s) posted:`);
  for (const c of posted) {
    // Every notification this challenge produced, on either side. A post
    // with a dash here is a post nobody was told about.
    const notes = await db.userNotification.count({
      where: { link: `/challenges/${c.id}` },
    });
    console.log(
      `   · ${c.createdAt.toISOString().slice(0, 16).replace("T", " ")}  ` +
        `${(c.teamName ?? "—").padEnd(22).slice(0, 22)} ${c.sport.padEnd(11)} ${c.status.padEnd(10)} ` +
        `notifications: ${notes === 0 ? "NONE" : String(notes)}`,
    );
  }

  /* ── 5. The conclusion, stated rather than left to inference ── */
  head("READING THIS");

  const anySend = (lastDispatch?.attempted ?? 0) > 0;
  const okRate =
    dispatches.reduce((t, d) => t + (d._sum.succeeded ?? 0), 0) /
    Math.max(1, dispatches.reduce((t, d) => t + (d._sum.attempted ?? 0), 0));

  if (devices.length === 0) {
    console.log("   ✗ No devices. Nothing else here can be trusted — register one first.");
  } else if (!anySend) {
    console.log("   ✗ Devices exist but nothing has been sent. Suspect the send path.");
  } else if (okRate < 0.5) {
    console.log(`   ✗ Sends are happening but only ${(okRate * 100).toFixed(0)}% land. Suspect FCM credentials or dead tokens.`);
  } else {
    console.log(`   ✓ The pipeline works — ${(okRate * 100).toFixed(0)}% of attempted sends land.`);
    console.log("     A silent event is therefore a MISSING SENDER, not a broken pipeline.");
    console.log("     Check the CHALLENGES block above: a post with 'notifications: NONE'");
    console.log("     means no code path sends anything when a challenge is posted.");
  }

  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect().catch(() => undefined);
  process.exit(1);
});
