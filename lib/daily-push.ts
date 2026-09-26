import { db } from "@/lib/db";
import { getSlotAvailability } from "@/lib/availability";
import { sendTemplatedToTokens, sendTemplatedToUser } from "@/lib/push-templates";
import {
  daysSince,
  daysUntil,
  decide,
  istDayKey,
  istDayStart,
  istHourOf,
  runRefusal,
  RULE_LABEL,
  type CandidateFacts,
  type DailyPushLimits,
  type DailyPushRuleKey,
  type VenueFacts,
} from "@/lib/daily-push-rules";

/**
 * The daily push — the one scheduled, non-transactional message in the
 * product.
 *
 * ── SHAPE OF A RUN ────────────────────────────────────────────────────
 * Gather once, decide per person, claim, then fan out per message. The
 * decisions themselves live in lib/daily-push-rules.ts and are pure; this
 * file is the part that touches the database and FCM, and it deliberately
 * holds no opinions the rules module could have held instead.
 *
 * ── WHY EVERYTHING IS BATCHED ─────────────────────────────────────────
 * Eight queries regardless of audience size, then one FCM multicast per
 * message. The obvious per-user shape — load a user, check their passes,
 * check their bookings, send — is around six round trips each, which at
 * four hundred users is two and a half thousand queries against a
 * serverless Postgres. lib/availability.ts carries the scar from exactly
 * that mistake: a per-court-day call inside a sweep that then took 231
 * seconds on a 60-second schedule.
 *
 * ── PERSONAL vs SHARED ────────────────────────────────────────────────
 * PASS_EXPIRY says "₹800 left on your Monthly Cricket, expires Friday" —
 * different words per person, so it goes one send per user. The other
 * three say the same sentence to everybody who matched, so they render
 * once and go out as a single multicast. That split is the reason the
 * daily_* templates carry no per-user variables, and there is a note on
 * them in lib/push-templates.ts saying so.
 */

export const DEFAULT_DAILY_PUSH: DailyPushLimits = {
  enabled: false,
  sendHourIST: 19,
  quietFromHour: 22,
  quietToHour: 8,
  maxPerUserPerWeek: 2,
  skipIfBookedSoon: true,
  skipIfPushedToday: true,
  passExpiry: { enabled: true, days: 3 },
  neverBooked: { enabled: true, days: 7 },
  lapsed: { enabled: true, days: 30 },
  freeSlots: { enabled: true, fromHour: 18, minOpen: 2 },
};

/** Settings as the rules module wants them, defaults when the row is absent. */
export async function loadDailyPushSettings(): Promise<DailyPushLimits> {
  let row = null;
  try {
    row = await db.dailyPushSettings.findUnique({ where: { id: "singleton" } });
  } catch (err) {
    // Missing table during a pre-migration deploy window. Falling back to
    // the defaults is safe here in a way it would not be for a
    // transactional push, because the default is `enabled: false` — the
    // failure mode is silence, not an unconfigured fan-out.
    console.warn(
      "[daily-push] settings lookup failed, using defaults:",
      err instanceof Error ? err.message : err,
    );
  }
  if (!row) return DEFAULT_DAILY_PUSH;
  return {
    enabled: row.enabled,
    sendHourIST: row.sendHourIST,
    quietFromHour: row.quietFromHour,
    quietToHour: row.quietToHour,
    maxPerUserPerWeek: row.maxPerUserPerWeek,
    skipIfBookedSoon: row.skipIfBookedSoon,
    skipIfPushedToday: row.skipIfPushedToday,
    passExpiry: { enabled: row.rulePassExpiryEnabled, days: row.rulePassExpiryDays },
    neverBooked: { enabled: row.ruleNeverBookedEnabled, days: row.ruleNeverBookedDays },
    lapsed: { enabled: row.ruleLapsedEnabled, days: row.ruleLapsedDays },
    freeSlots: {
      enabled: row.ruleFreeSlotsEnabled,
      fromHour: row.ruleFreeSlotsFromHour,
      minOpen: row.ruleFreeSlotsMinOpen,
    },
  };
}

const SPORT_WORD: Record<string, string> = {
  CRICKET: "Cricket",
  FOOTBALL: "Football",
  PICKLEBALL: "Pickleball",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "31 Aug" — a date a person reads, not one a machine parses. */
function dayLabel(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]}`;
}

/** "3 hours", "90 minutes", "1 hour" — never "3.0 hrs". */
function balanceLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  const rounded = Math.round(hours * 10) / 10;
  if (Number.isInteger(rounded)) return `${rounded} hour${rounded === 1 ? "" : "s"}`;
  return `${rounded} hours`;
}

/** "Cricket and football", "Cricket, football and pickleball". */
function joinSports(sports: string[]): string {
  const words = sports.map((s, i) =>
    i === 0 ? (SPORT_WORD[s] ?? s) : (SPORT_WORD[s] ?? s).toLowerCase(),
  );
  if (words.length <= 1) return words[0] ?? "Courts";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * What is actually free this evening.
 *
 * Counts (sport, hour) pairs rather than court-configs, and the
 * difference is the difference between an honest number and a flattering
 * one: a full-pitch config and the two half-pitch configs carved out of
 * it are three rows describing one piece of ground, so counting configs
 * would advertise three free slots where a customer can book one game.
 * A pair is what the book screen offers, so a pair is what we count.
 *
 * Hours already gone are excluded. At a 7pm send, "6pm" is not a slot
 * anybody can take, and counting it is the same lie by another route.
 */
export async function venueFactsTonight(
  limits: DailyPushLimits,
  now: Date,
): Promise<VenueFacts & { sports: string[] }> {
  if (!limits.freeSlots.enabled) return { freeSlotsTonight: 0, sports: [] };

  const configs = await db.courtConfig.findMany({
    where: { isActive: true },
    select: { id: true, sport: true },
  });
  if (configs.length === 0) return { freeSlotsTonight: 0, sports: [] };

  const fromHour = Math.max(limits.freeSlots.fromHour, istHourOf(now) + 1);
  const today = istDayStart(now);

  // One availability read per active court config, once a day. Costly
  // enough to be worth naming (see the note at the top of
  // lib/availability.ts) but bounded by the number of courts, not by the
  // number of customers — which is the property that matters.
  const perConfig = await Promise.all(
    configs.map(async (c) => {
      try {
        const slots = await getSlotAvailability(c.id, today);
        return { sport: c.sport as string, slots };
      } catch (err) {
        // One unreadable court must not cost the whole run its fallback
        // message. Undercounting is the safe direction: it can only make
        // us say less than is true.
        console.warn(
          `[daily-push] availability failed for court ${c.id}:`,
          err instanceof Error ? err.message : err,
        );
        return { sport: c.sport as string, slots: [] };
      }
    }),
  );

  const pairs = new Set<string>();
  for (const { sport, slots } of perConfig) {
    for (const s of slots) {
      if (s.status === "available" && s.hour >= fromHour) pairs.add(`${sport}:${s.hour}`);
    }
  }

  const sports = [...new Set([...pairs].map((p) => p.split(":")[0]))].sort(
    (a, b) => Object.keys(SPORT_WORD).indexOf(a) - Object.keys(SPORT_WORD).indexOf(b),
  );
  return { freeSlotsTonight: pairs.size, sports };
}

// ── The run ────────────────────────────────────────────────────────────

export interface BucketReport {
  rule: DailyPushRuleKey;
  label: string;
  /** People who would receive it. */
  count: number;
  /** A sample of who, for the dry run. Names only, capped. */
  sample: string[];
  /** Rendered copy, as it would land — only known for shared rules. */
  title: string | null;
  body: string | null;
  attempted: number;
  succeeded: number;
}

export interface DailyPushRun {
  /** Why nothing happened, when nothing did. */
  refusal: string | null;
  dryRun: boolean;
  /** Reachable customers considered. */
  considered: number;
  sent: number;
  buckets: BucketReport[];
  /** Suppression reason → how many people it accounted for. */
  skipped: Record<string, number>;
  venue: { freeSlotsTonight: number; sports: string[] };
  ranAt: string;
}

/** Which template carries each rule. PASS_EXPIRY reuses the orphan. */
const TEMPLATE_FOR: Record<DailyPushRuleKey, "pass_expiring_soon" | "daily_never_booked" | "daily_lapsed" | "daily_free_slots"> = {
  PASS_EXPIRY: "pass_expiring_soon",
  NEVER_BOOKED: "daily_never_booked",
  LAPSED: "daily_lapsed",
  FREE_SLOTS: "daily_free_slots",
};

/**
 * Where a tap lands. Every one of these already routes on the installed
 * app: `open_screen` + `url` runs through resolveDeepLink, which has had
 * /passes and /book branches since the promo-banner work. That matters
 * more than it looks — it means the deep links work on the 80% of
 * installs still behind the OTA canary, so the module is not waiting on
 * a rollout to be useful.
 */
const LINK_FOR: Record<DailyPushRuleKey, string> = {
  PASS_EXPIRY: "/passes",
  NEVER_BOOKED: "/book",
  LAPSED: "/book",
  FREE_SLOTS: "/book",
};

/**
 * Evaluate, and unless this is a dry run, send.
 *
 * `dryRun` is the only way to run this outside the send hour, and the
 * refusal check below enforces that: a caller cannot ask for "ignore the
 * schedule" and "actually send" together, because the combination is how
 * a test at 3pm becomes a real push at 3pm.
 */
export async function runDailyPush(
  opts: { now?: Date; dryRun?: boolean } = {},
): Promise<DailyPushRun> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? false;
  const limits = await loadDailyPushSettings();
  const ranAt = now.toISOString();

  const empty = (refusal: string | null): DailyPushRun => ({
    refusal,
    dryRun,
    considered: 0,
    sent: 0,
    buckets: [],
    skipped: {},
    venue: { freeSlotsTonight: 0, sports: [] },
    ranAt,
  });

  // A dry run answers "what would tonight look like", so it skips the
  // clock but NOT the switch: previewing a module the venue has turned
  // off should say it is off rather than quietly showing a plan.
  if (!dryRun) {
    const refusal = runRefusal(limits, now);
    if (refusal) return empty(refusal);
  } else if (!limits.enabled) {
    return empty("the daily push is switched off");
  }

  // ── Gather. Eight queries, none of them per-user. ───────────────────
  //
  // TWO date values, and they are not interchangeable. `dayStart` is the
  // instant the IST day began (18:30 UTC yesterday) and belongs in
  // timestamp comparisons. `dayKey` is the IST calendar date and is the
  // only thing that may touch DailyPushSend.sentOn, a @db.Date column.
  // Using dayStart there filed rows under the previous day and produced
  // an equality check that could never be true.
  const dayStart = istDayStart(now);
  const dayKey = istDayKey(now);
  const weekAgo = new Date(now.getTime() - 7 * 86400_000);
  const tomorrowEnd = new Date(dayStart.getTime() + 2 * 86400_000);
  // Identifies the rows THIS run claims. See DailyPushSend.runId.
  const runId = `${dayKey.toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 10)}`;

  const devices = await db.pushDevice.findMany({ select: { userId: true, token: true } });
  if (devices.length === 0) return empty("no registered devices");

  const tokensByUser = new Map<string, string[]>();
  for (const d of devices) {
    const list = tokensByUser.get(d.userId);
    if (list) list.push(d.token);
    else tokensByUser.set(d.userId, [d.token]);
  }
  const userIds = [...tokensByUser.keys()];

  const [users, recentSends, pushedToday, bookedSoon, lastBookings, passes, venue] =
    await Promise.all([
      db.user.findMany({
        where: { id: { in: userIds }, deletedAt: null },
        select: { id: true, name: true, createdAt: true, offersOptOut: true },
      }),
      db.dailyPushSend.findMany({
        where: { userId: { in: userIds }, createdAt: { gte: weekAgo } },
        select: { userId: true, sentOn: true },
      }),
      db.pushDispatch.findMany({
        where: { userId: { in: userIds }, createdAt: { gte: dayStart } },
        select: { userId: true },
      }),
      db.booking.findMany({
        where: {
          userId: { in: userIds },
          status: { not: "CANCELLED" },
          date: { gte: dayStart, lt: tomorrowEnd },
        },
        select: { userId: true },
      }),
      db.booking.groupBy({
        by: ["userId"],
        where: { userId: { in: userIds }, status: { not: "CANCELLED" } },
        _max: { date: true },
      }),
      db.userPass.findMany({
        where: {
          userId: { in: userIds },
          status: "ACTIVE",
          cancelledAt: null,
          remainingMinutes: { gt: 0 },
          expiresAt: { gt: now },
        },
        select: { userId: true, name: true, remainingMinutes: true, expiresAt: true },
        orderBy: { expiresAt: "asc" },
      }),
      venueFactsTonight(limits, now),
    ]);

  const sendsThisWeek = new Map<string, number>();
  const sentToday = new Set<string>();
  for (const s of recentSends) {
    sendsThisWeek.set(s.userId, (sendsThisWeek.get(s.userId) ?? 0) + 1);
    // Compared against dayKey, not dayStart — sentOn is a @db.Date and
    // comes back at UTC midnight of the IST calendar date.
    if (s.sentOn.getTime() === dayKey.getTime()) sentToday.add(s.userId);
  }
  const heardToday = new Set(pushedToday.map((p) => p.userId));
  const playingSoon = new Set(bookedSoon.map((b) => b.userId));
  const lastPlayed = new Map(
    lastBookings.filter((b) => b._max.date).map((b) => [b.userId, b._max.date as Date]),
  );
  // Ordered by expiry, so the FIRST pass seen for a user is the soonest —
  // which is the one whose money is about to go.
  const soonestPass = new Map<string, { name: string; remainingMinutes: number; expiresAt: Date }>();
  for (const p of passes) if (!soonestPass.has(p.userId)) soonestPass.set(p.userId, p);

  // ── Decide. ────────────────────────────────────────────────────────
  type Winner = { userId: string; name: string | null; rule: DailyPushRuleKey };
  const winners: Winner[] = [];
  const skipped: Record<string, number> = {};

  for (const u of users) {
    const pass = soonestPass.get(u.id);
    const last = lastPlayed.get(u.id);
    const facts: CandidateFacts = {
      optedOut: u.offersOptOut,
      sendsInLastWeek: sendsThisWeek.get(u.id) ?? 0,
      alreadySentToday: sentToday.has(u.id),
      hadTargetedPushToday: heardToday.has(u.id),
      hasBookingSoon: playingSoon.has(u.id),
      passExpiryInDays: pass ? daysUntil(pass.expiresAt, now) : null,
      accountAgeDays: daysSince(u.createdAt, now),
      daysSinceLastBooking: last ? daysSince(last, now) : null,
    };
    const d = decide(facts, limits, venue);
    if (d.send) winners.push({ userId: u.id, name: u.name, rule: d.rule });
    else skipped[d.reason] = (skipped[d.reason] ?? 0) + 1;
  }

  const byRule = new Map<DailyPushRuleKey, Winner[]>();
  for (const w of winners) {
    const list = byRule.get(w.rule);
    if (list) list.push(w);
    else byRule.set(w.rule, [w]);
  }

  const sharedVars = {
    count: String(venue.freeSlotsTonight),
    sports: joinSports(venue.sports),
  };

  const buckets: BucketReport[] = [];
  let sent = 0;

  for (const [rule, group] of byRule) {
    const report: BucketReport = {
      rule,
      label: RULE_LABEL[rule],
      count: group.length,
      sample: group.slice(0, 5).map((g) => g.name || "(no name)"),
      title: null,
      body: null,
      attempted: 0,
      succeeded: 0,
    };

    if (dryRun) {
      // Render without sending, so the admin reads the actual sentence
      // rather than the template with braces in it.
      const { renderPushTemplate } = await import("@/lib/push-templates");
      const rendered = await renderPushTemplate(
        TEMPLATE_FOR[rule],
        rule === "PASS_EXPIRY"
          ? { planName: "their pass", balance: "the balance", expiry: "the expiry date" }
          : sharedVars,
      );
      report.title = rendered?.title ?? "(template is switched off)";
      report.body = rendered?.body ?? "";
      buckets.push(report);
      continue;
    }

    // CLAIM FIRST, for the whole bucket, before a single message goes.
    //
    // Same discipline as announceNewChallenges: the unique index on
    // (userId, sentOn) means a second overlapping run cannot write a
    // second row for the same person on the same day. Claiming before
    // the send makes the failure mode a missed message rather than a
    // duplicated one — the right way round when the audience is four
    // hundred strangers.
    const claim = await db.dailyPushSend.createMany({
      data: group.map((g) => ({ userId: g.userId, ruleKey: rule, sentOn: dayKey, runId })),
      skipDuplicates: true,
    });
    if (claim.count === 0) continue;

    // Only the rows THIS run won may be sent to, and `runId` is what
    // makes that answerable. createMany reports how many rows it
    // inserted but not which, so re-reading by (day, rule, users) hands
    // back rows an EARLIER run wrote as well — and a bucket holding a
    // mix of already-sent and newly-eligible people would then message
    // all of them again. Filtering on runId returns exactly this run's,
    // with the unique index arbitrating who won each contested row.
    const claimed = await db.dailyPushSend.findMany({
      where: { runId, ruleKey: rule },
      select: { userId: true },
    });
    const mine = new Set(claimed.map((c) => c.userId));
    const recipients = group.filter((g) => mine.has(g.userId));

    if (rule === "PASS_EXPIRY") {
      // Personal: one render and one send each, because the sentence
      // names their pass and their balance.
      for (const r of recipients) {
        const pass = soonestPass.get(r.userId);
        if (!pass) continue;
        const res = await sendTemplatedToUser(
          r.userId,
          "pass_expiring_soon",
          {
            planName: pass.name,
            balance: balanceLabel(pass.remainingMinutes),
            expiry: dayLabel(pass.expiresAt),
          },
          { kind: "open_screen", url: LINK_FOR[rule], source: "daily_push", rule },
          { source: "scheduled", audience: `daily:${rule}` },
        );
        report.attempted += res.attempted;
        report.succeeded += res.succeeded;
      }
    } else {
      // Shared: one render, one multicast.
      const tokens = recipients.flatMap((r) => tokensByUser.get(r.userId) ?? []);
      const res = await sendTemplatedToTokens(
        tokens,
        TEMPLATE_FOR[rule],
        sharedVars,
        { kind: "open_screen", url: LINK_FOR[rule], source: "daily_push", rule },
        { source: "scheduled", audience: `daily:${rule}` },
      );
      report.attempted = res.attempted;
      report.succeeded = res.succeeded;
    }

    report.count = recipients.length;
    sent += recipients.length;
    buckets.push(report);
  }

  return {
    refusal: null,
    dryRun,
    considered: users.length,
    sent: dryRun ? 0 : sent,
    buckets,
    skipped,
    venue,
    ranAt,
  };
}
