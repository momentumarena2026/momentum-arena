"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import {
  DEFAULT_DAILY_PUSH,
  loadDailyPushSettings,
  runDailyPush,
  templateEnabledByRule,
  venueFactsTonight,
  type DailyPushRun,
} from "@/lib/daily-push";
import {
  settingsRefusal,
  istDayKey,
  RULE_LABEL,
  RULE_PRIORITY,
  type DailyPushLimits,
} from "@/lib/daily-push-rules";
import {
  occasionsFor,
  calendarOccasionsFor,
  libraryRefusal,
  NEEDS_SLOTS,
  WEEKDAY_TAGS,
} from "@/lib/daily-push-lines";

const PERMISSION = "MANAGE_PUSH";

export interface DailyPushAdminView {
  settings: DailyPushLimits;
  /** Customers who could be reached at all — at least one live device. */
  reachable: number;
  /** ...of whom, how many have switched the daily push off. */
  optedOut: number;
  /** Sends in the trailing seven days, by rule.
   *
   *  `copyOff` is the answer to a question the page could not previously
   *  ask: is this rule's MESSAGE switched off on the templates page? A
   *  rule that is on with its copy off sends nothing, and before this
   *  the dashboard showed it as fully live. */
  lastWeekByRule: { rule: string; label: string; count: number; copyOff: boolean }[];
  /** The most recent send, so an admin can see it is actually running. */
  lastSentAt: string | null;
}

export async function getDailyPushAdminView(): Promise<DailyPushAdminView> {
  await requireAdmin(PERMISSION);

  const weekAgo = new Date(Date.now() - 7 * 86400_000);
  const [settings, deviceUsers, recent, latest, copyLive] = await Promise.all([
    loadDailyPushSettings(),
    db.pushDevice.findMany({ select: { userId: true }, distinct: ["userId"] }),
    db.dailyPushSend.groupBy({
      by: ["ruleKey"],
      where: { createdAt: { gte: weekAgo } },
      _count: { _all: true },
    }),
    db.dailyPushSend.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    templateEnabledByRule(),
  ]);

  const reachableIds = deviceUsers.map((d) => d.userId);
  const optedOut =
    reachableIds.length === 0
      ? 0
      : await db.user.count({
          where: { id: { in: reachableIds }, deletedAt: null, offersOptOut: true },
        });

  const counts = new Map(recent.map((r) => [r.ruleKey, r._count._all]));
  return {
    settings,
    reachable: reachableIds.length,
    optedOut,
    lastWeekByRule: RULE_PRIORITY.map((rule) => ({
      rule,
      label: RULE_LABEL[rule],
      count: counts.get(rule) ?? 0,
      // EVERYONE_ELSE has no template — its copy is the line library,
      // whose own failure is reported as `lineRefusal` on a dry run.
      copyOff: rule === "EVERYONE_ELSE" ? false : !copyLive[rule],
    })),
    lastSentAt: latest?.createdAt.toISOString() ?? null,
  };
}

/**
 * Save, or refuse and say which two fields disagree.
 *
 * The validation is `settingsRefusal` from the pure rules module — the
 * same function the tests exercise — rather than a second copy of the
 * bounds written against the form. A module that is switched on but
 * structurally incapable of sending is the worst of the three states,
 * because it reports success over an empty run; better to refuse here.
 */
export async function saveDailyPushSettings(
  input: DailyPushLimits,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await requireAdmin(PERMISSION);

  const refusal = settingsRefusal(input);
  if (refusal) return { ok: false, error: refusal };

  const data = {
    enabled: input.enabled,
    sendHourIST: input.sendHourIST,
    quietFromHour: input.quietFromHour,
    quietToHour: input.quietToHour,
    maxPerUserPerWeek: input.maxPerUserPerWeek,
    skipIfBookedSoon: input.skipIfBookedSoon,
    maxPushesPerDay: input.maxPushesPerDay,
    maxSameRulePerMonth: input.maxSameRulePerMonth,
    rulePassExpiryEnabled: input.passExpiry.enabled,
    rulePassExpiryDays: input.passExpiry.days,
    ruleNeverBookedEnabled: input.neverBooked.enabled,
    ruleNeverBookedDays: input.neverBooked.days,
    ruleLapsedEnabled: input.lapsed.enabled,
    ruleLapsedDays: input.lapsed.days,
    ruleFreeSlotsEnabled: input.everyoneElse.enabled,
    ruleFreeSlotsFromHour: input.everyoneElse.fromHour,
    ruleFreeSlotsMinOpen: input.everyoneElse.minOpen,
    updatedByAdminId: admin.id,
  };

  try {
    await db.dailyPushSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data },
      update: data,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not save the settings.",
    };
  }

  revalidatePath("/admin/push/daily");
  return { ok: true };
}

/**
 * What tonight's run would do, without doing it.
 *
 * The only verification either the venue or I get before this reaches
 * real phones: there is no staging device fleet, so "send it and see"
 * means sending it to customers. A dry run evaluates every rule against
 * the real audience, renders the real copy, and sends nothing.
 *
 * It deliberately ignores the clock (so it can be run at 3pm) but NOT
 * the enable switch — previewing a module the venue has turned off
 * should say that, not quietly show a plan that is not going to happen.
 */
export async function dryRunDailyPush(): Promise<DailyPushRun> {
  await requireAdmin(PERMISSION);
  return runDailyPush({ dryRun: true });
}

/** Restore the shipped defaults without wiping the enable switch. */
export async function resetDailyPushDefaults(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  await requireAdmin(PERMISSION);
  const current = await loadDailyPushSettings();
  return saveDailyPushSettings({ ...DEFAULT_DAILY_PUSH, enabled: current.enabled });
}

// ── The creative line library ──────────────────────────────────────────

export interface DailyPushLineView {
  id: string;
  title: string;
  body: string;
  tags: string[];
  enabled: boolean;
  useCount: number;
  lastUsedAt: string | null;
}

export interface DailyPushOccasionView {
  id: string;
  tag: string;
  label: string;
  startsOn: string;
  endsOn: string;
  /** True while today falls inside the window. */
  active: boolean;
}

export interface DailyPushLibraryView {
  lines: DailyPushLineView[];
  occasions: DailyPushOccasionView[];
  /** Everything true about today, computed + dated. */
  todaysOccasions: string[];
  /** The subset that came from a dated window — only these beat the
   *  everyday pool. */
  calendarOccasions: string[];
  /** Tags used by lines that have no dated window, so they never fire. */
  undatedTags: string[];
  /** Whether the evening counts as having space right now. Without it
   *  the page would count `needs-slots` lines as live on a full night,
   *  and tell the venue more of the library is in play than is. */
  slotsAreFree: boolean;
  /** Why the library cannot speak today, or null. */
  refusal: string | null;
}

/** Tags the module works out for itself — these need no window. */
const COMPUTED_TAGS = new Set([
  ...WEEKDAY_TAGS,
  "weekend",
  "weekday",
  "monsoon",
  "winter",
  "summer",
  "pleasant",
  NEEDS_SLOTS,
]);

export async function getDailyPushLibrary(): Promise<DailyPushLibraryView> {
  await requireAdmin(PERMISSION);

  const now = new Date();
  const [lines, occasions, settings] = await Promise.all([
    db.dailyPushLine.findMany({
      orderBy: [{ enabled: "desc" }, { lastUsedAt: { sort: "asc", nulls: "first" } }, { title: "asc" }],
    }),
    db.dailyPushOccasion.findMany({ orderBy: { startsOn: "asc" } }),
    loadDailyPushSettings(),
  ]);

  const dayKey = istDayKey(now);
  const todaysOccasions = occasionsFor(dayKey, occasions);
  const venue = await venueFactsTonight(settings, now);
  const calendarOccasions = calendarOccasionsFor(dayKey, occasions);
  const ctx = {
    occasions: todaysOccasions,
    calendarOccasions,
    slotsAreFree: venue.freeSlotsTonight >= Math.max(1, settings.everyoneElse.minOpen),
  };

  const dated = new Set(occasions.map((o) => o.tag));
  const undated = new Set<string>();
  for (const l of lines) {
    if (!l.enabled) continue;
    for (const t of l.tags) {
      if (!COMPUTED_TAGS.has(t) && !dated.has(t)) undated.add(t);
    }
  }

  const today = dayKey.toISOString().slice(0, 10);
  return {
    lines: lines.map((l) => ({
      id: l.id,
      title: l.title,
      body: l.body,
      tags: l.tags,
      enabled: l.enabled,
      useCount: l.useCount,
      lastUsedAt: l.lastUsedAt?.toISOString() ?? null,
    })),
    occasions: occasions.map((o) => {
      const from = o.startsOn.toISOString().slice(0, 10);
      const to = o.endsOn.toISOString().slice(0, 10);
      return {
        id: o.id,
        tag: o.tag,
        label: o.label,
        startsOn: from,
        endsOn: to,
        active: today >= from && today <= to,
      };
    }),
    todaysOccasions,
    calendarOccasions,
    undatedTags: [...undated].sort(),
    slotsAreFree: ctx.slotsAreFree,
    refusal: libraryRefusal(lines, ctx),
  };
}

export interface SaveLineInput {
  id?: string;
  title: string;
  body: string;
  tags: string[];
  enabled: boolean;
}

/**
 * Create or update one line.
 *
 * Length limits mirror what a lock screen actually shows, because a
 * line truncated mid-joke is worse than a shorter one. Placeholders are
 * refused outright: this copy is multicast to everybody, so a `{name}`
 * here would go out literally, to hundreds of people, as `{name}`.
 */
export async function saveDailyPushLine(
  input: SaveLineInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const admin = await requireAdmin(PERMISSION);

  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 3) return { ok: false, error: "The title needs at least 3 characters." };
  if (title.length > 60) return { ok: false, error: "Keep the title under 60 characters — a lock screen truncates around 40." };
  if (body.length < 3) return { ok: false, error: "The body needs at least 3 characters." };
  if (body.length > 200) return { ok: false, error: "Keep the body under 200 characters." };
  if (/\{[a-zA-Z_]+\}/.test(title + body)) {
    return {
      ok: false,
      error: "No {placeholders} here. This line is sent to everybody at once, so a placeholder would go out literally.",
    };
  }

  const tags = [...new Set(input.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];

  try {
    if (input.id) {
      await db.dailyPushLine.update({
        where: { id: input.id },
        data: { title, body, tags, enabled: input.enabled },
      });
      revalidatePath("/admin/push/daily/lines");
      return { ok: true, id: input.id };
    }
    const created = await db.dailyPushLine.create({
      data: { title, body, tags, enabled: input.enabled, createdByAdminId: admin.id },
      select: { id: true },
    });
    revalidatePath("/admin/push/daily/lines");
    return { ok: true, id: created.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not save the line." };
  }
}

export async function deleteDailyPushLine(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin(PERMISSION);
  try {
    await db.dailyPushLine.delete({ where: { id } });
    revalidatePath("/admin/push/daily/lines");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not delete it." };
  }
}

export async function saveDailyPushOccasion(input: {
  id?: string;
  tag: string;
  label: string;
  startsOn: string;
  endsOn: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin(PERMISSION);

  const tag = input.tag.trim().toLowerCase();
  if (!/^[a-z0-9-]{2,30}$/.test(tag)) {
    return { ok: false, error: "A tag is 2–30 characters, lowercase letters, numbers and hyphens." };
  }
  if (COMPUTED_TAGS.has(tag)) {
    return {
      ok: false,
      error: `"${tag}" is worked out from the calendar already — it needs no window, and adding one would not change when it fires.`,
    };
  }
  const from = new Date(`${input.startsOn}T00:00:00.000Z`);
  const to = new Date(`${input.endsOn}T00:00:00.000Z`);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return { ok: false, error: "Both dates must be valid." };
  }
  if (to < from) return { ok: false, error: "The end date cannot be before the start date." };

  const data = { tag, label: input.label.trim() || tag, startsOn: from, endsOn: to };
  try {
    if (input.id) await db.dailyPushOccasion.update({ where: { id: input.id }, data });
    else await db.dailyPushOccasion.create({ data });
    revalidatePath("/admin/push/daily/lines");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not save it." };
  }
}

export async function deleteDailyPushOccasion(id: string): Promise<{ ok: boolean }> {
  await requireAdmin(PERMISSION);
  await db.dailyPushOccasion.delete({ where: { id } }).catch(() => {});
  revalidatePath("/admin/push/daily/lines");
  return { ok: true };
}
