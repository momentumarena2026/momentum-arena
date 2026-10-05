import { db } from "@/lib/db";
import { getSlotAvailability } from "@/lib/availability";
import { sendToTokens } from "@/lib/push";
import { sendTemplatedToTokens, sendTemplatedToUser } from "@/lib/push-templates";
import {
  occasionsFor,
  calendarOccasionsFor,
  pickLine,
  libraryRefusal,
  type LineCandidate,
} from "@/lib/daily-push-lines";
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
  maxPushesPerDay: 2,
  maxSameRulePerMonth: 2,
  passExpiry: { enabled: true, days: 3 },
  neverBooked: { enabled: true, days: 7 },
  lapsed: { enabled: true, days: 30 },
  everyoneElse: { enabled: true, fromHour: 18, minOpen: 2 },
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
    maxPushesPerDay: row.maxPushesPerDay,
    maxSameRulePerMonth: row.maxSameRulePerMonth,
    passExpiry: { enabled: row.rulePassExpiryEnabled, days: row.rulePassExpiryDays },
    neverBooked: { enabled: row.ruleNeverBookedEnabled, days: row.ruleNeverBookedDays },
    lapsed: { enabled: row.ruleLapsedEnabled, days: row.ruleLapsedDays },
    everyoneElse: {
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
  if (!limits.everyoneElse.enabled) return { freeSlotsTonight: 0, sports: [] };

  const configs = await db.courtConfig.findMany({
    where: { isActive: true },
    select: { id: true, sport: true },
  });
  if (configs.length === 0) return { freeSlotsTonight: 0, sports: [] };

  const fromHour = Math.max(limits.everyoneElse.fromHour, istHourOf(now) + 1);
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
  /** What kind of day the library thought it was. */
  occasions: string[];
  /** The creative line chosen for EVERYONE_ELSE, or why there was none. */
  line: { id: string; title: string; body: string } | null;
  lineRefusal: string | null;
  ranAt: string;
}

/**
 * Which of the four messages an admin has switched off.
 *
 * ── WHY THIS HAS TO BE READ BEFORE DECIDING, NOT BEFORE SENDING ──────
 * There are two switches for each rule and they sit one click apart:
 * the rule itself (on this module's page) and its copy (on the shared
 * templates page). They read as the same action, so they must behave
 * the same way.
 *
 * They did not. The engine claims a bucket BEFORE it sends, and a
 * disabled template makes the send a no-op — so those people were
 * marked "sent today", spent a slot against their weekly cap, and
 * received nothing. Worse, they did not fall through to the next rule
 * either, because the disabled rule had already matched them. Switching
 * off a message quietly ate its audience.
 *
 * Folding the template state into the rule state here fixes both halves
 * at once: a rule whose copy is off is simply not a rule, so matchRule
 * moves to the next one exactly as it would for a rule the admin
 * switched off directly.
 * ──────────────────────────────────────────────────────────────────────
 */
export async function templateEnabledByRule(): Promise<
  Record<Exclude<DailyPushRuleKey, "EVERYONE_ELSE">, boolean>
> {
  // EVERYONE_ELSE is absent on purpose: its copy is the line library,
  // not a registered template. Its equivalent gate is "does the library
  // have something eligible today", applied in runDailyPush.
  const all: Record<Exclude<DailyPushRuleKey, "EVERYONE_ELSE">, boolean> = {
    PASS_EXPIRY: true,
    NEVER_BOOKED: true,
    LAPSED: true,
  };
  try {
    const rows = await db.pushTemplate.findMany({
      where: { key: { in: Object.values(TEMPLATE_FOR) } },
      select: { key: true, enabled: true },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.enabled]));
    for (const rule of Object.keys(all) as (keyof typeof all)[]) {
      // An absent row means defaults, and the default is enabled.
      all[rule] = byKey.get(TEMPLATE_FOR[rule]) ?? true;
    }
  } catch (err) {
    // Same reasoning as renderPushTemplate: a lookup failure must not
    // silence the module, only fall back to the registry defaults.
    console.warn(
      "[daily-push] template state lookup failed, assuming all enabled:",
      err instanceof Error ? err.message : err,
    );
  }
  return all;
}

/** Fold "is the copy switched on?" into "is the rule switched on?". */
function withTemplateState(
  limits: DailyPushLimits,
  live: Record<Exclude<DailyPushRuleKey, "EVERYONE_ELSE">, boolean>,
  libraryCanSpeak: boolean,
): DailyPushLimits {
  return {
    ...limits,
    passExpiry: { ...limits.passExpiry, enabled: limits.passExpiry.enabled && live.PASS_EXPIRY },
    neverBooked: { ...limits.neverBooked, enabled: limits.neverBooked.enabled && live.NEVER_BOOKED },
    lapsed: { ...limits.lapsed, enabled: limits.lapsed.enabled && live.LAPSED },
    // The library is to EVERYONE_ELSE what a template is to the others:
    // if it cannot produce a line today, the rule must not match, or it
    // claims people and sends them nothing.
    everyoneElse: { ...limits.everyoneElse, enabled: limits.everyoneElse.enabled && libraryCanSpeak },
  };
}

/** Which template carries each rule. PASS_EXPIRY reuses the orphan. */
const TEMPLATE_FOR: Record<
  Exclude<DailyPushRuleKey, "EVERYONE_ELSE">,
  "pass_expiring_soon" | "daily_never_booked" | "daily_lapsed"
> = {
  PASS_EXPIRY: "pass_expiring_soon",
  NEVER_BOOKED: "daily_never_booked",
  LAPSED: "daily_lapsed",
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
  EVERYONE_ELSE: "/book",
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
  const settings = await loadDailyPushSettings();
  const ranAt = now.toISOString();

  const empty = (refusal: string | null): DailyPushRun => ({
    refusal,
    dryRun,
    considered: 0,
    sent: 0,
    buckets: [],
    skipped: {},
    venue: { freeSlotsTonight: 0, sports: [] },
    occasions: [],
    line: null,
    lineRefusal: null,
    ranAt,
  });

  // A dry run answers "what would tonight look like", so it skips the
  // clock but NOT the switch: previewing a module the venue has turned
  // off should say it is off rather than quietly showing a plan.
  if (!dryRun) {
    const refusal = runRefusal(settings, now);
    if (refusal) return empty(refusal);
  } else if (!settings.enabled) {
    return empty("the daily push is switched off");
  }

  // ── What kind of day is it, and what have we got to say? ───────────
  //
  // Before anything else, because the answer decides whether
  // EVERYONE_ELSE is a live rule at all. Availability is read here too:
  // it does not gate the rule any more, only the lines that claim free
  // courts.
  const dayKeyForLine = istDayKey(now);
  const [occasionRows, lineRows, venueNow] = await Promise.all([
    db.dailyPushOccasion
      .findMany({ select: { tag: true, label: true, startsOn: true, endsOn: true } })
      .catch(() => []),
    db.dailyPushLine
      .findMany({
        select: { id: true, title: true, body: true, tags: true, enabled: true, lastUsedAt: true },
      })
      .catch((): LineCandidate[] => []),
    venueFactsTonight(settings, now),
  ]);

  const occasions = occasionsFor(dayKeyForLine, occasionRows);
  const lineCtx = {
    occasions,
    calendarOccasions: calendarOccasionsFor(dayKeyForLine, occasionRows),
    slotsAreFree: venueNow.freeSlotsTonight >= Math.max(1, settings.everyoneElse.minOpen),
  };
  const todaysLine = pickLine(lineRows, lineCtx);
  const lineRefusal = libraryRefusal(lineRows, lineCtx);

  const limits = withTemplateState(
    settings,
    await templateEnabledByRule(),
    todaysLine !== null,
  );

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
  const monthAgo = new Date(now.getTime() - 30 * 86400_000);
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

  const [users, recentSends, monthSends, pushedToday, bookedSoon, lastBookings, passes] =
    await Promise.all([
      db.user.findMany({
        where: { id: { in: userIds }, deletedAt: null },
        select: { id: true, name: true, createdAt: true, offersOptOut: true },
      }),
      db.dailyPushSend.findMany({
        where: { userId: { in: userIds }, createdAt: { gte: weekAgo } },
        select: { userId: true, sentOn: true },
      }),
      // A month of per-rule history, for maxSameRulePerMonth. Separate
      // from the week above because they answer different questions:
      // that one rations nudges, this one stops the SAME nudge.
      db.dailyPushSend.findMany({
        where: { userId: { in: userIds }, createdAt: { gte: monthAgo } },
        select: { userId: true, ruleKey: true },
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
    ]);
  const venue = venueNow;

  const sendsThisWeek = new Map<string, number>();
  const sentToday = new Set<string>();
  for (const s of recentSends) {
    sendsThisWeek.set(s.userId, (sendsThisWeek.get(s.userId) ?? 0) + 1);
    // Compared against dayKey, not dayStart — sentOn is a @db.Date and
    // comes back at UTC midnight of the IST calendar date.
    if (s.sentOn.getTime() === dayKey.getTime()) sentToday.add(s.userId);
  }
  // A COUNT per person, not a set: the daily ceiling asks "how many",
  // and a boolean could only ever answer "any".
  const ruleHistory = new Map<string, Partial<Record<DailyPushRuleKey, number>>>();
  for (const r of monthSends) {
    const k = r.ruleKey as DailyPushRuleKey;
    const m = ruleHistory.get(r.userId) ?? {};
    m[k] = (m[k] ?? 0) + 1;
    ruleHistory.set(r.userId, m);
  }

  const heardToday = new Map<string, number>();
  for (const p of pushedToday) {
    if (p.userId) heardToday.set(p.userId, (heardToday.get(p.userId) ?? 0) + 1);
  }
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
      pushesToday: heardToday.get(u.id) ?? 0,
      hasBookingSoon: playingSoon.has(u.id),
      passExpiryInDays: pass ? daysUntil(pass.expiresAt, now) : null,
      accountAgeDays: daysSince(u.createdAt, now),
      ruleSentThisMonth: ruleHistory.get(u.id) ?? {},
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
      if (rule === "EVERYONE_ELSE") {
        report.title = todaysLine?.title ?? "(no line available today)";
        report.body = todaysLine?.body ?? "";
      } else {
        const { renderPushTemplate } = await import("@/lib/push-templates");
        const rendered = await renderPushTemplate(
          TEMPLATE_FOR[rule],
          rule === "PASS_EXPIRY"
            ? { planName: "their pass", balance: "the balance", expiry: "the expiry date" }
            : {},
        );
        report.title = rendered?.title ?? "(template is switched off)";
        report.body = rendered?.body ?? "";
      }
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
    } else if (rule === "EVERYONE_ELSE") {
      // The creative line. THE ONE SANCTIONED EXCEPTION to THE RULE in
      // lib/push-templates.ts, and worth stating why: a registered
      // template is a fixed sentence an admin may edit, and this copy is
      // deliberately a different sentence every day. The intent behind
      // THE RULE — that no automated push has copy nobody can see or
      // switch off — is met by the line library instead, which is
      // editable, per-line switchable and visible in the same dashboard.
      // Putting a rotating pool behind a single template row would have
      // made the template a lie.
      if (!todaysLine) continue; // guarded above; belt and braces
      const tokens = recipients.flatMap((r) => tokensByUser.get(r.userId) ?? []);
      const res = await sendToTokens(
        tokens,
        {
          title: todaysLine.title,
          body: todaysLine.body,
          data: { kind: "open_screen", url: LINK_FOR[rule], source: "daily_push", rule },
        },
        { scope: "customer", source: "scheduled", audience: `daily:${rule}` },
      );
      report.attempted = res.attempted;
      report.succeeded = res.succeeded;
      report.title = todaysLine.title;
      report.body = todaysLine.body;

      // Stamp the rotation only after the send was attempted, so a line
      // that never went out does not lose its place in the queue.
      await db.dailyPushLine.update({
        where: { id: todaysLine.id },
        data: { lastUsedAt: now, useCount: { increment: 1 } },
      }).catch(() => {});
    } else {
      // Shared: one render, one multicast.
      const tokens = recipients.flatMap((r) => tokensByUser.get(r.userId) ?? []);
      const res = await sendTemplatedToTokens(
        tokens,
        TEMPLATE_FOR[rule],
        {},
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
    occasions,
    line: todaysLine ? { id: todaysLine.id, title: todaysLine.title, body: todaysLine.body } : null,
    lineRefusal,
    ranAt,
  };
}
