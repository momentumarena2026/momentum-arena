"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import {
  DEFAULT_DAILY_PUSH,
  loadDailyPushSettings,
  runDailyPush,
  type DailyPushRun,
} from "@/lib/daily-push";
import {
  settingsRefusal,
  RULE_LABEL,
  RULE_PRIORITY,
  type DailyPushLimits,
} from "@/lib/daily-push-rules";

const PERMISSION = "MANAGE_PUSH";

export interface DailyPushAdminView {
  settings: DailyPushLimits;
  /** Customers who could be reached at all — at least one live device. */
  reachable: number;
  /** ...of whom, how many have switched the daily push off. */
  optedOut: number;
  /** Sends in the trailing seven days, by rule. */
  lastWeekByRule: { rule: string; label: string; count: number }[];
  /** The most recent send, so an admin can see it is actually running. */
  lastSentAt: string | null;
}

export async function getDailyPushAdminView(): Promise<DailyPushAdminView> {
  await requireAdmin(PERMISSION);

  const weekAgo = new Date(Date.now() - 7 * 86400_000);
  const [settings, deviceUsers, recent, latest] = await Promise.all([
    loadDailyPushSettings(),
    db.pushDevice.findMany({ select: { userId: true }, distinct: ["userId"] }),
    db.dailyPushSend.groupBy({
      by: ["ruleKey"],
      where: { createdAt: { gte: weekAgo } },
      _count: { _all: true },
    }),
    db.dailyPushSend.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
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
    skipIfPushedToday: input.skipIfPushedToday,
    rulePassExpiryEnabled: input.passExpiry.enabled,
    rulePassExpiryDays: input.passExpiry.days,
    ruleNeverBookedEnabled: input.neverBooked.enabled,
    ruleNeverBookedDays: input.neverBooked.days,
    ruleLapsedEnabled: input.lapsed.enabled,
    ruleLapsedDays: input.lapsed.days,
    ruleFreeSlotsEnabled: input.freeSlots.enabled,
    ruleFreeSlotsFromHour: input.freeSlots.fromHour,
    ruleFreeSlotsMinOpen: input.freeSlots.minOpen,
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
