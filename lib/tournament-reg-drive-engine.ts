/**
 * The registration drive, executed.
 *
 * Rules live next door in lib/tournament-reg-drive.ts and are pure.
 * This file is the part that touches the database and FCM, and it is
 * deliberately thin: everything it decides, it decides by asking that
 * module.
 *
 * ── THE ORDER OF OPERATIONS IS THE DESIGN ─────────────────────────────
 * Claim, then send. The DriveSend rows go in BEFORE the multicast, so a
 * crash midway costs a message rather than duplicating one. That is the
 * right way round when the audience is "everybody who hasn't entered":
 * a nudge nobody received is invisible, a nudge received twice is a
 * complaint.
 *
 * The daily push learned both halves of this the hard way — see gotcha
 * 19 (an IST day is two different values and a `@db.Date` takes the
 * wrong one, which left its in-memory idempotency check dead while a
 * unique index hid the fact) and the `runId` note below.
 * ──────────────────────────────────────────────────────────────────────
 */
import { db } from "@/lib/db";
import { sendTemplatedToTokens } from "@/lib/push-templates";
import {
  driveRefusal,
  driveSuppression,
  driveVars,
  pickDriveLine,
  renderDriveCopy,
  istDayKey,
  type DriveLimits,
  type DriveLine,
} from "@/lib/tournament-reg-drive";

/**
 * Shared with the daily push, on purpose.
 *
 * `maxPushesPerDay` is the venue's ceiling on targeted pushes per
 * person per day from ALL sources. Reading it from the daily push's
 * settings row rather than keeping a second copy is what stops the two
 * modules each honouring "two a day" and a customer getting four.
 */
const DEFAULT_LIMITS: DriveLimits = {
  maxPushesPerDay: 2,
  maxConsecutiveDays: 3,
  quietFromHour: 22,
  quietToHour: 8,
};

export interface DriveReport {
  tournamentId: string;
  slug: string;
  name: string;
  /** Null when the drive ran. */
  refusal: string | null;
  line: string | null;
  eligible: number;
  suppressed: Record<string, number>;
  attempted: number;
  succeeded: number;
  dryRun: boolean;
}

/**
 * Run the drive for every tournament that currently wants one.
 *
 * Returns a report per tournament INCLUDING the ones that refused,
 * because "why did nothing go out" is the question this is always asked
 * and an empty array cannot answer it.
 */
export async function runRegDrives(
  opts: { now?: Date; dryRun?: boolean; onlyTournamentId?: string } = {},
): Promise<{ ran: number; reports: DriveReport[] }> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? false;

  const limits = await loadLimits();

  // PUBLISHED is not included: registration has not opened, so there is
  // nothing to drive towards. Everything past REG_OPEN has stopped by
  // definition and driveRefusal says so for any that slip through.
  const tournaments = await db.tournament.findMany({
    where: {
      status: "REG_OPEN",
      ...(opts.onlyTournamentId ? { id: opts.onlyTournamentId } : {}),
    },
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      regDriveEnabled: true,
      regDriveHourIST: true,
      regCloseAt: true,
      totalTeams: true,
      entryFee: true,
      prizePool: true,
    },
  });

  const reports: DriveReport[] = [];
  let ran = 0;
  for (const t of tournaments) {
    const report = await runOne(t, limits, now, dryRun);
    reports.push(report);
    if (!report.refusal) ran++;
  }
  return { ran, reports };
}

/**
 * The daily push's settings row is the single home for the shared
 * ceiling and quiet hours. Missing row = the module was never
 * configured, so fall back to defaults rather than refusing: the drive
 * is a tournament feature and must not be hostage to another module's
 * setup.
 */
async function loadLimits(): Promise<DriveLimits> {
  const s = await db.dailyPushSettings.findUnique({ where: { id: "singleton" } });
  if (!s) return DEFAULT_LIMITS;
  return {
    maxPushesPerDay: s.maxPushesPerDay,
    maxConsecutiveDays: DEFAULT_LIMITS.maxConsecutiveDays,
    quietFromHour: s.quietFromHour,
    quietToHour: s.quietToHour,
  };
}

type DriveTournament = {
  id: string;
  slug: string;
  name: string;
  status: string;
  regDriveEnabled: boolean;
  regDriveHourIST: number;
  regCloseAt: Date | null;
  totalTeams: number;
  entryFee: number;
  prizePool: number | null;
};

async function runOne(
  t: DriveTournament,
  limits: DriveLimits,
  now: Date,
  dryRun: boolean,
): Promise<DriveReport> {
  const base: DriveReport = {
    tournamentId: t.id,
    slug: t.slug,
    name: t.name,
    refusal: null,
    line: null,
    eligible: 0,
    suppressed: {},
    attempted: 0,
    succeeded: 0,
    dryRun,
  };

  const [confirmedTeams, pendingTeams, lineRows] = await Promise.all([
    db.tournamentTeam.count({ where: { tournamentId: t.id, status: "CONFIRMED" } }),
    db.tournamentTeam.count({ where: { tournamentId: t.id, status: "PENDING_PAYMENT" } }),
    db.tournamentCampaignItem.findMany({
      where: { tournamentId: t.id, recurring: true, kind: "PUSH" },
      select: { id: true, title: true, body: true, enabled: true, sentAt: true },
    }),
  ]);

  const refusal = driveRefusal(
    {
      status: t.status,
      regDriveEnabled: t.regDriveEnabled,
      regDriveHourIST: t.regDriveHourIST,
      regCloseAt: t.regCloseAt,
      totalTeams: t.totalTeams,
      confirmedTeams,
      pendingTeams,
      enabledLines: lineRows.filter((l) => l.enabled).length,
    },
    now,
  );
  // A dry run may ignore the clock, but nothing else. Being able to ask
  // "what would this send?" at 3pm is the point; being able to ask it
  // on a tournament that is full is a way to talk yourself into sending.
  if (refusal && !(dryRun && refusal.startsWith("not the send hour"))) {
    return { ...base, refusal };
  }

  const line = pickDriveLine(lineRows as DriveLine[]);
  if (!line) return { ...base, refusal: "no drive line is available" };

  const vars = driveVars(
    { ...t, confirmedTeams },
    now,
  );
  const title = renderDriveCopy(line.title, vars);
  const body = renderDriveCopy(line.body ?? "", vars);
  base.line = title;

  // ── Audience ────────────────────────────────────────────────────────
  // Everyone with a device, minus everyone already in. `captainUserId`
  // is nullable — a team entered at the counter has no user attached —
  // so the filter below can only exclude people who registered through
  // an account, which is the set that could receive a push anyway.
  const dayKey = istDayKey(now);
  const [entrants, sentToday, recentSends, devices] = await Promise.all([
    db.tournamentTeam
      .findMany({
        where: { tournamentId: t.id, status: { in: ["CONFIRMED", "PENDING_PAYMENT", "WAITLISTED"] } },
        select: { captainUserId: true },
      })
      .then((rows) => new Set(rows.map((r) => r.captainUserId).filter(Boolean) as string[])),
    db.tournamentRegDriveSend
      .findMany({ where: { tournamentId: t.id, sentOn: dayKey }, select: { userId: true } })
      .then((rows) => new Set(rows.map((r) => r.userId))),
    consecutiveDaysByUser(t.id, now),
    db.pushDevice.findMany({ select: { token: true, userId: true } }),
  ]);

  const byUser = new Map<string, string[]>();
  for (const d of devices) {
    if (!d.userId) continue;
    byUser.set(d.userId, [...(byUser.get(d.userId) ?? []), d.token]);
  }

  const optedOut = await db.user
    .findMany({
      // The SAME opt-out the daily push honours (User.offersOptOut).
      // A customer who switched marketing messages off switched off
      // marketing messages, not one module's worth of them.
      where: { id: { in: [...byUser.keys()] }, offersOptOut: true },
      select: { id: true },
    })
    .then((rows) => new Set(rows.map((r) => r.id)));

  const pushesToday = await pushesTodayByUser([...byUser.keys()], now);

  const eligible: string[] = [];
  const suppressed: Record<string, number> = {};
  for (const userId of byUser.keys()) {
    const why = driveSuppression(
      {
        optedOut: optedOut.has(userId),
        alreadyEntered: entrants.has(userId),
        alreadySentToday: sentToday.has(userId),
        pushesToday: pushesToday.get(userId) ?? 0,
        consecutiveDays: recentSends.get(userId) ?? 0,
      },
      limits,
    );
    if (why) suppressed[why] = (suppressed[why] ?? 0) + 1;
    else eligible.push(userId);
  }

  base.eligible = eligible.length;
  base.suppressed = suppressed;
  if (dryRun || eligible.length === 0) return base;

  // ── Claim, then send ────────────────────────────────────────────────
  // skipDuplicates means a concurrent run that claimed some of these
  // loses only those rows; createMany reports how many it actually
  // inserted, and only those people are ours to message.
  const claim = await db.tournamentRegDriveSend.createMany({
    data: eligible.map((userId) => ({ tournamentId: t.id, userId, itemId: line.id, sentOn: dayKey })),
    skipDuplicates: true,
  });
  if (claim.count === 0) return base;

  // Re-read to learn WHICH rows are ours rather than assuming the whole
  // list is. Scoped by itemId as well as the day: a concurrent run
  // using a different line would otherwise hand us its audience.
  const mine = await db.tournamentRegDriveSend.findMany({
    where: { tournamentId: t.id, sentOn: dayKey, itemId: line.id, userId: { in: eligible } },
    select: { userId: true },
  });
  const tokens = mine.flatMap((m) => byUser.get(m.userId) ?? []);
  if (tokens.length === 0) return base;

  const res = await sendTemplatedToTokens(
    tokens,
    "tournament_reg_drive",
    {
      title,
      body,
      tournament: t.name,
      spotsLeft: vars.spotsLeft,
      daysLeft: vars.daysLeft,
    },
    // open_screen + url routes through the app's existing deep-link
    // resolver, which has had a /tournaments/<slug> branch since the
    // match-centre work — so this lands on the tournament page even on
    // installs still behind the OTA canary.
    { kind: "open_screen", url: `/tournaments/${t.slug}`, source: "reg_drive", tournamentId: t.id },
    { source: "scheduled", audience: `reg-drive:${t.slug}` },
  );

  // `sentAt` is the rotation cursor for a recurring item, not a
  // completion marker — the status stays DRAFT for its whole life.
  await db.tournamentCampaignItem.update({
    where: { id: line.id },
    data: { sentAt: now, useCount: { increment: 1 } },
  });

  base.attempted = res.attempted;
  base.succeeded = res.succeeded;
  return base;
}

/**
 * How many days running the drive has reached each person.
 *
 * Counted backwards from yesterday and stopping at the first gap, so a
 * person messaged on Monday and Thursday reads as 1, not 2. Looks back
 * a bounded window — past the cap there is no behavioural difference
 * between "four days running" and "forty".
 */
async function consecutiveDaysByUser(
  tournamentId: string,
  now: Date,
): Promise<Map<string, number>> {
  const LOOKBACK = 10;
  const today = istDayKey(now);
  const since = new Date(today.getTime() - LOOKBACK * 86400_000);
  const rows = await db.tournamentRegDriveSend.findMany({
    where: { tournamentId, sentOn: { gte: since, lt: today } },
    select: { userId: true, sentOn: true },
  });

  const byUser = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = r.sentOn.toISOString().slice(0, 10);
    byUser.set(r.userId, (byUser.get(r.userId) ?? new Set()).add(key));
  }

  const out = new Map<string, number>();
  for (const [userId, days] of byUser) {
    let streak = 0;
    for (let back = 1; back <= LOOKBACK; back++) {
      const d = new Date(today.getTime() - back * 86400_000).toISOString().slice(0, 10);
      if (!days.has(d)) break;
      streak++;
    }
    out.set(userId, streak);
  }
  return out;
}

/** Targeted pushes each user has already had today, from every source. */
async function pushesTodayByUser(userIds: string[], now: Date): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const dayStart = new Date(istDayKey(now).getTime() - 5.5 * 3600_000);
  const rows = await db.pushDispatch.groupBy({
    by: ["userId"],
    where: { userId: { in: userIds }, createdAt: { gte: dayStart } },
    _count: { _all: true },
  });
  return new Map(
    rows.filter((r) => r.userId).map((r) => [r.userId as string, r._count._all]),
  );
}
