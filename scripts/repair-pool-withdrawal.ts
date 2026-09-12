/**
 * Repair a pool after a team withdrew mid-tournament.
 *
 * This is the one-off counterpart to the withdrawTeam action: the action
 * handles it correctly from now on, but a tournament already in this
 * state was repaired by hand — a fixture added manually, a match scored
 * by mistake — and hand repairs leave the data in exactly the shape the
 * action was written to prevent.
 *
 * What it does, in order:
 *
 *   1. Marks the withdrawing team WITHDRAWN, which is what drops it from
 *      the points table — those count CONFIRMED teams only.
 *   2. Deletes every fixture involving it and releases the court hours
 *      those were holding. Results included: a team that never turned up
 *      has no results worth keeping, and the one match that got scored
 *      here was started by mistake. Each is named before it goes.
 *   3. Adopts orphaned POOL-stage matches into the pool whose teams they
 *      pair. A hand-added fixture carries no poolId, and the points table
 *      selects a pool's matches BY poolId — so the decider an organiser
 *      adds between the two remaining teams is invisible to the table it
 *      was added to affect.
 *   4. Tops the pool up so the survivors have a full schedule — two legs
 *      when two are left, because one match cannot separate two teams on
 *      anything but the result, and net run rate computed from a single
 *      innings each is noise.
 *   5. Renumbers the pool so it reads 1..n rather than as the history of
 *      its own repair.
 *
 * Dry run by default; --apply writes. Nothing is implicit: both the
 * tournament and the team are named on the command line, so this cannot
 * wander into an event it was not pointed at.
 *
 *   npx tsx scripts/repair-pool-withdrawal.ts \
 *     --slug=momentum-t10-cup --team="Blasters" [--apply]
 */
import { PrismaClient } from "@prisma/client";
import { missingPoolPairings, poolLegs } from "../lib/tournament-fixtures";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const SLUG = arg("slug");
const TEAM = arg("team");

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

async function main() {
  if (!SLUG || !TEAM) {
    fail('Usage: --slug=<tournament-slug> --team="<team name>" [--apply]');
  }
  console.log(APPLY ? "APPLYING" : "DRY RUN — pass --apply to write");
  console.log("");

  const t = await db.tournament.findUnique({
    where: { slug: SLUG },
    select: {
      id: true,
      name: true,
      status: true,
      sport: true,
      pools: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          name: true,
          teams: { select: { id: true, name: true, status: true } },
        },
      },
    },
  });
  if (!t) fail(`No tournament with slug "${SLUG}"`);
  console.log(`${t.name} — ${t.status}`);

  // Matched case-insensitively but required to be UNIQUE: acting on the
  // wrong team here would delete another team's fixtures.
  const everyTeam = t.pools.flatMap((p) =>
    p.teams.map((x) => ({ ...x, poolId: p.id, poolName: p.name })),
  );
  const hits = everyTeam.filter(
    (x) => x.name.trim().toLowerCase() === TEAM.trim().toLowerCase(),
  );
  if (hits.length === 0) {
    console.log("");
    console.log("Teams in this tournament's pools:");
    for (const x of everyTeam) console.log(`   ${x.poolName}: ${x.name} [${x.status}]`);
    fail(`No team named "${TEAM}" in a pool of ${t.name}`);
  }
  if (hits.length > 1) fail(`"${TEAM}" matches ${hits.length} teams — names must be unique`);
  const team = hits[0];
  const pool = t.pools.find((p) => p.id === team.poolId)!;
  console.log(`Withdrawing: ${team.name} (${pool.name}) — currently ${team.status}`);

  const survivors = pool.teams.filter((x) => x.id !== team.id && x.status === "CONFIRMED");
  console.log(`Remaining in ${pool.name}: ${survivors.map((s) => s.name).join(", ") || "(none)"}`);
  console.log("");

  // ── 2. The withdrawn team's fixtures ──────────────────────────────
  const theirs = await db.tournamentMatch.findMany({
    where: {
      tournamentId: t.id,
      OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }],
    },
    select: {
      id: true,
      roundLabel: true,
      status: true,
      homeScore: true,
      awayScore: true,
      slotBlockIds: true,
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  });
  console.log(`Fixtures involving ${team.name}: ${theirs.length} — all will be deleted`);
  for (const m of theirs) {
    const score =
      m.homeScore != null || m.awayScore != null ? ` ${m.homeScore ?? "-"}/${m.awayScore ?? "-"}` : "";
    const flag = ["COMPLETED", "LIVE", "WALKOVER"].includes(m.status) ? "  ⚠ carries a result" : "";
    console.log(
      `   − ${m.roundLabel} — ${m.homeTeam?.name ?? "TBD"} v ${m.awayTeam?.name ?? "TBD"} [${m.status}]${score}${flag}`,
    );
  }
  const blocksFreed = theirs.flatMap((m) => m.slotBlockIds);
  console.log(`   court-hour blocks released: ${blocksFreed.length}`);
  console.log("");

  // ── 3. Orphaned POOL matches that belong to a pool ─────────────────
  const deadIds = new Set(theirs.map((m) => m.id));
  const orphans = await db.tournamentMatch.findMany({
    where: { tournamentId: t.id, stage: "POOL", poolId: null },
    select: {
      id: true,
      roundLabel: true,
      status: true,
      homeTeamId: true,
      awayTeamId: true,
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  });
  const poolOf = new Map(everyTeam.map((x) => [x.id, x.poolId]));
  const adopt: { id: string; poolId: string; label: string }[] = [];
  for (const m of orphans) {
    if (deadIds.has(m.id)) continue; // about to be deleted anyway
    const h = m.homeTeamId ? poolOf.get(m.homeTeamId) : null;
    const a = m.awayTeamId ? poolOf.get(m.awayTeamId) : null;
    // Only when the two agree. Teams from different pools have no single
    // right answer, and guessing would file a result in the wrong table.
    if (h && h === a) {
      adopt.push({
        id: m.id,
        poolId: h,
        label: `${m.roundLabel} — ${m.homeTeam?.name} v ${m.awayTeam?.name} [${m.status}]`,
      });
    }
  }
  console.log(`Hand-added POOL matches with no pool: ${orphans.length - [...orphans].filter((m) => deadIds.has(m.id)).length} adoptable: ${adopt.length}`);
  for (const a of adopt) {
    const name = t.pools.find((p) => p.id === a.poolId)?.name;
    console.log(`   → ${name}: ${a.label}`);
  }
  console.log("");

  // ── 4. Top the pool back up ───────────────────────────────────────
  const poolMatches = await db.tournamentMatch.findMany({
    where: { poolId: pool.id },
    select: { id: true, homeTeamId: true, awayTeamId: true },
  });
  // Everything the pool will still hold afterwards: its own surviving
  // matches plus the ones being adopted into it.
  const adoptedHere = adopt.filter((a) => a.poolId === pool.id).map((a) => a.id);
  const adoptedRows = orphans.filter((m) => adoptedHere.includes(m.id));
  const surviving = [
    ...poolMatches.filter((m) => !deadIds.has(m.id)),
    ...adoptedRows.map((m) => ({ id: m.id, homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId })),
  ];
  const ids = survivors.map((s) => s.id);
  const legs = poolLegs(ids.length);
  const toCreate = ids.length >= 2 ? missingPoolPairings(ids, legs, surviving) : [];
  const nameOf = new Map(everyTeam.map((x) => [x.id, x.name]));
  console.log(
    `${pool.name} owes ${legs} leg${legs === 1 ? "" : "s"} per pair — ${toCreate.length} new fixture${toCreate.length === 1 ? "" : "s"}`,
  );
  for (const [h, a] of toCreate) console.log(`   + ${nameOf.get(h)} v ${nameOf.get(a)}`);
  console.log("");

  if (!APPLY) {
    console.log("DRY RUN — nothing written.");
    return;
  }

  // ── Write ─────────────────────────────────────────────────────────
  const stageMax = await db.tournamentMatch.aggregate({
    where: { tournamentId: t.id, stage: "POOL" },
    _max: { sequence: true },
  });

  await db.$transaction(async (tx) => {
    // A deleted match must not leave a later round pointing at it for a
    // team that will now never be decided.
    await tx.tournamentMatch.updateMany({
      where: { homeSourceMatchId: { in: [...deadIds] } },
      data: { homeSourceMatchId: null, homeTeamId: null },
    });
    await tx.tournamentMatch.updateMany({
      where: { awaySourceMatchId: { in: [...deadIds] } },
      data: { awaySourceMatchId: null, awayTeamId: null },
    });
    if (blocksFreed.length) {
      await tx.slotBlock.deleteMany({ where: { id: { in: blocksFreed } } });
    }
    // Player stats and match events cascade from the match row itself.
    if (deadIds.size) {
      await tx.tournamentMatch.deleteMany({ where: { id: { in: [...deadIds] } } });
    }
    for (const a of adopt) {
      await tx.tournamentMatch.update({ where: { id: a.id }, data: { poolId: a.poolId } });
    }
    await tx.tournamentTeam.update({
      where: { id: team.id },
      data: { status: "WITHDRAWN" },
    });

    let seq = stageMax._max.sequence ?? 0;
    for (const [home, away] of toCreate) {
      seq += 1;
      await tx.tournamentMatch.create({
        data: {
          tournamentId: t.id,
          stage: "POOL",
          poolId: pool.id,
          roundLabel: `${pool.name} · Match ${seq}`,
          sequence: seq,
          homeTeamId: home,
          awayTeamId: away,
        },
      });
    }
  });

  // Renumber every pool so each reads 1..n.
  const { renumberedLabels } = await import("../lib/tournament-fixtures");
  const rows = await db.tournamentMatch.findMany({
    where: { tournamentId: t.id, stage: "POOL" },
    orderBy: { sequence: "asc" },
    select: { id: true, roundLabel: true, pool: { select: { name: true } } },
  });
  const updates = renumberedLabels(
    rows.map((r) => ({ id: r.id, roundLabel: r.roundLabel, poolName: r.pool?.name ?? null })),
  );
  for (const u of updates) {
    await db.tournamentMatch.update({ where: { id: u.id }, data: { roundLabel: u.roundLabel } });
  }

  console.log("Done.");
  console.log("");
  const after = await db.tournamentMatch.findMany({
    where: { poolId: pool.id },
    orderBy: { sequence: "asc" },
    select: {
      roundLabel: true,
      status: true,
      homeScore: true,
      awayScore: true,
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  });
  console.log(`${pool.name} now:`);
  for (const m of after) {
    const score =
      m.homeScore != null || m.awayScore != null ? ` ${m.homeScore ?? "-"}/${m.awayScore ?? "-"}` : "";
    console.log(
      `   ${m.roundLabel} — ${m.homeTeam?.name ?? "TBD"} v ${m.awayTeam?.name ?? "TBD"} [${m.status}]${score}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
