"use server";

import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { isParseableTerm } from "@/lib/booking-bot/parse";
import { invalidateQuickBookSettings } from "@/lib/booking-bot/settings";
import { revalidatePath } from "next/cache";

/**
 * Review surface for Quick book's learning loop.
 *
 * The comprehension layer writes down every word it resolved that our
 * own vocabulary lacked. Those rows are useless until a human looks at
 * them: an unreviewed vocabulary is just the model's mistakes recorded
 * permanently, and a wrong mapping here would make the RULE parser
 * confidently wrong with no model call left to blame.
 *
 * Approving a term is therefore the one action in this module that
 * changes customer-facing behaviour, and it is deliberately a decision
 * somebody makes rather than a threshold something crosses.
 */

async function requireBotAdmin() {
  const user = await requireAdminBase("MANAGE_BOOKING_BOT");
  return user.id;
}

export interface PendingTerm {
  id: string;
  term: string;
  canonical: string;
  seenCount: number;
  approved: boolean;
  createdAt: string;
  /**
   * Whether approving this actually changes anything.
   *
   * A term rewrites a word INTO its canonical form, so it only helps if
   * the parser understands the canonical. "criket" → "cricket" pays off
   * at once; "shaam" → "evening" does not, because nothing resolves
   * "evening" to an hour. Shown so a reviewer approves terms that do
   * something rather than terms that merely read correctly.
   */
  effective: boolean;
  /** Real messages this word appeared in, for judging the mapping. */
  examples: string[];
}

export interface BotStats {
  total: number;
  viaModel: number;
  viaRules: number;
  /** The number this whole loop exists to move. */
  rulesOnlyPct: number;
  confirmed: number;
  rejected: number;
  avgLatencyMs: number | null;
}

export interface Disagreement {
  id: string;
  text: string;
  rules: string;
  model: string;
  createdAt: string;
}

/**
 * Everything the review page needs, in one round trip.
 *
 * Examples are matched with a `contains` on the raw message rather than
 * stored per-term: the term table would otherwise need a join table for
 * something a reviewer glances at once and never queries again.
 */
export async function getBookingBotOverview(): Promise<{
  terms: PendingTerm[];
  stats: BotStats;
  disagreements: Disagreement[];
}> {
  await requireBotAdmin();

  const [rows, total, viaModel, confirmed, rejected, latency, recent] =
    await Promise.all([
      db.bookingBotTerm.findMany({
        orderBy: [{ approved: "asc" }, { seenCount: "desc" }, { createdAt: "desc" }],
        take: 200,
      }),
      db.bookingBotLog.count(),
      db.bookingBotLog.count({ where: { NOT: { route: "" } } }),
      db.bookingBotLog.count({ where: { confirmed: true } }),
      db.bookingBotLog.count({ where: { NOT: { rejected: null } } }),
      db.bookingBotLog.aggregate({
        _avg: { latencyMs: true },
        where: { NOT: { latencyMs: null } },
      }),
      db.bookingBotLog.findMany({
        // Only rows that actually reached the model can disagree with
        // the rules. `route` is the reliable filter — a Json column's
        // null has two meanings in Prisma and neither is worth relying on.
        where: { NOT: { route: "" } },
        orderBy: { createdAt: "desc" },
        take: 40,
        select: {
          id: true,
          text: true,
          parserResult: true,
          llmResult: true,
          finalResult: true,
          createdAt: true,
        },
      }),
    ]);

  const examplesFor = await Promise.all(
    rows.slice(0, 40).map((t) =>
      db.bookingBotLog.findMany({
        where: { text: { contains: t.term, mode: "insensitive" } },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { text: true },
      }),
    ),
  );

  const terms: PendingTerm[] = rows.map((t, i) => ({
    id: t.id,
    term: t.term,
    canonical: t.canonical,
    seenCount: t.seenCount,
    approved: t.approved,
    createdAt: t.createdAt.toISOString(),
    effective: isParseableTerm(t.canonical),
    examples: (examplesFor[i] ?? []).map((e) => e.text),
  }));

  /**
   * Rows where the rules and the model both produced a reading and they
   * differ. The highest-value thing in the table: a disagreement says
   * which of the two was wrong, and half the time it is our own rules.
   */
  const disagreements: Disagreement[] = [];
  for (const r of recent) {
    const rules = r.parserResult as Record<string, unknown> | null;
    const model = r.llmResult;
    if (!rules || typeof model !== "object" || model === null) continue;
    const m = model as Record<string, unknown>;
    const differs =
      (m.date != null && rules.date != null && m.date !== rules.date) ||
      (m.startHour != null && rules.startHour != null && m.startHour !== rules.startHour) ||
      (m.sport != null && rules.sport != null && m.sport !== rules.sport);
    if (!differs) continue;
    disagreements.push({
      id: r.id,
      text: r.text,
      rules: `${rules.sport ?? "—"} · ${rules.date ?? "—"} · ${rules.startHour ?? "—"}-${rules.endHour ?? "—"}`,
      model: `${m.sport ?? "—"} · ${m.date ?? "—"} · ${m.startHour ?? "—"}-${m.endHour ?? "—"}`,
      createdAt: r.createdAt.toISOString(),
    });
  }

  return {
    terms,
    stats: {
      total,
      viaModel,
      viaRules: total - viaModel,
      rulesOnlyPct: total > 0 ? Math.round(((total - viaModel) / total) * 100) : 0,
      confirmed,
      rejected,
      avgLatencyMs: latency._avg.latencyMs != null ? Math.round(latency._avg.latencyMs) : null,
    },
    disagreements: disagreements.slice(0, 12),
  };
}

/**
 * Approve a term, optionally correcting what it means first.
 *
 * The canonical is editable at approval time because the model's
 * suggestion is a suggestion. It gets the same shape check the harvester
 * applies — a single short alphabetic word — since anything else cannot
 * be a vocabulary entry and would sit in the parser doing nothing.
 */
export async function approveBookingBotTerm(
  id: string,
  canonical?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireBotAdmin();

  const next = (canonical ?? "").toLowerCase().trim();
  if (canonical != null && !/^[a-z]{3,20}$/.test(next)) {
    return { ok: false, error: "A meaning must be one word, 3-20 letters." };
  }

  try {
    const row = await db.bookingBotTerm.findUnique({ where: { id } });
    if (!row) return { ok: false, error: "That word is no longer in the list." };
    // Refuse a self-mapping outright: rewriting a word to itself is a
    // no-op that would look approved and do nothing forever.
    const meaning = next || row.canonical;
    if (meaning === row.term) {
      return { ok: false, error: "That maps the word to itself, which changes nothing." };
    }
    await db.bookingBotTerm.update({
      where: { id },
      data: { approved: true, canonical: meaning },
    });
  } catch {
    return { ok: false, error: "Couldn't save that. Try again." };
  }

  revalidatePath("/admin/booking-bot");
  return { ok: true };
}

/** Withdraw an approved term. The rules stop resolving it immediately. */
export async function unapproveBookingBotTerm(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireBotAdmin();
  try {
    await db.bookingBotTerm.update({ where: { id }, data: { approved: false } });
  } catch {
    return { ok: false, error: "Couldn't save that. Try again." };
  }
  revalidatePath("/admin/booking-bot");
  return { ok: true };
}

/**
 * Discard a suggestion.
 *
 * Deleted rather than flagged, deliberately: the harvester re-creates a
 * row the next time a customer uses the word, so a genuinely common word
 * comes back and a one-off does not. Rejecting is "not yet", not "never".
 */
export async function rejectBookingBotTerm(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireBotAdmin();
  try {
    await db.bookingBotTerm.delete({ where: { id } });
  } catch {
    return { ok: false, error: "Couldn't remove that. Try again." };
  }
  revalidatePath("/admin/booking-bot");
  return { ok: true };
}

// ── Feature switches ────────────────────────────────────────────────

export interface QuickBookSettingsRow {
  enabled: boolean;
  newBadge: boolean;
  betaBadge: boolean;
}

export async function getQuickBookSettingsForAdmin(): Promise<QuickBookSettingsRow> {
  await requireBotAdmin();
  const row = await db.arenaSettings.findFirst({
    select: {
      quickBookEnabled: true,
      quickBookNewBadge: true,
      quickBookBetaBadge: true,
    },
  });
  return {
    enabled: row?.quickBookEnabled ?? true,
    newBadge: row?.quickBookNewBadge ?? true,
    betaBadge: row?.quickBookBetaBadge ?? true,
  };
}

/**
 * Flip one switch.
 *
 * ArenaSettings is a singleton with no fixed id, so the row is found and
 * updated rather than upserted on a known key — the same shape every
 * other settings action in this codebase uses. If it does not exist yet
 * the defaults in the schema already describe the intended state, so
 * there is nothing to write.
 */
export async function updateQuickBookSettings(
  patch: Partial<QuickBookSettingsRow>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireBotAdmin();
  try {
    const row = await db.arenaSettings.findFirst({ select: { id: true } });
    if (!row) return { ok: false, error: "Arena settings have not been created yet." };
    await db.arenaSettings.update({
      where: { id: row.id },
      data: {
        ...(patch.enabled !== undefined ? { quickBookEnabled: patch.enabled } : {}),
        ...(patch.newBadge !== undefined ? { quickBookNewBadge: patch.newBadge } : {}),
        ...(patch.betaBadge !== undefined ? { quickBookBetaBadge: patch.betaBadge } : {}),
      },
    });
  } catch {
    return { ok: false, error: "Couldn't save that. Try again." };
  }
  // Without this the switch appears not to work for up to 30 seconds,
  // which during an incident is exactly when somebody starts flipping it
  // repeatedly.
  invalidateQuickBookSettings();
  revalidatePath("/admin/booking-bot");
  return { ok: true };
}

// ── Logs, events and performance ────────────────────────────────────

export interface BotLogRow {
  id: string;
  text: string;
  /** "" when the rules answered alone — the outcome we want most. */
  route: string;
  rejected: string | null;
  latencyMs: number | null;
  confirmed: boolean;
  createdAt: string;
  rules: string;
  model: string;
  final: string;
  /** True when the model was asked and its answer was NOT what shipped. */
  overruled: boolean;
}

export interface BotPerformance {
  /** Model round-trip, in milliseconds, over the last 500 calls. */
  p50: number | null;
  p95: number | null;
  slowest: number | null;
  /** Why validation refused a model answer, most common first. */
  rejections: { reason: string; count: number }[];
  /** Messages per day for the last 14 days, oldest first. */
  daily: { day: string; total: number; viaModel: number }[];
}

function describe(v: unknown): string {
  if (!v || typeof v !== "object") return "—";
  const o = v as Record<string, unknown>;
  const time =
    o.startHour != null && o.endHour != null ? `${o.startHour}-${o.endHour}` : "—";
  return `${o.sport ?? "—"} · ${o.date ?? "—"} · ${time}`;
}

/**
 * One page of the event log.
 *
 * Offset paging on purpose: this is a human scrolling a few pages while
 * investigating something, not a feed, and an offset is what lets them
 * jump. `filter` narrows to the three questions actually asked of this
 * table — what did the model get asked, what did it get wrong, and what
 * turned into money.
 */
export async function getBookingBotLogs(opts: {
  page?: number;
  filter?: "all" | "model" | "rules" | "rejected" | "confirmed";
  search?: string;
}): Promise<{ rows: BotLogRow[]; total: number; pageSize: number }> {
  await requireBotAdmin();

  const pageSize = 25;
  const page = Math.max(0, Math.floor(opts.page ?? 0));
  const filter = opts.filter ?? "all";
  const search = (opts.search ?? "").trim();

  const where = {
    ...(filter === "model" ? { NOT: { route: "" } } : {}),
    ...(filter === "rules" ? { route: "" } : {}),
    ...(filter === "rejected" ? { NOT: { rejected: null } } : {}),
    ...(filter === "confirmed" ? { confirmed: true } : {}),
    ...(search ? { text: { contains: search, mode: "insensitive" as const } } : {}),
  };

  const [rows, total] = await Promise.all([
    db.bookingBotLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: page * pageSize,
      take: pageSize,
    }),
    db.bookingBotLog.count({ where }),
  ]);

  return {
    pageSize,
    total,
    rows: rows.map((r) => {
      const model = describe(r.llmResult);
      const final = describe(r.finalResult);
      return {
        id: r.id,
        text: r.text,
        route: r.route,
        rejected: r.rejected,
        latencyMs: r.latencyMs,
        confirmed: r.confirmed,
        createdAt: r.createdAt.toISOString(),
        rules: describe(r.parserResult),
        model,
        final,
        // Worth seeing at a glance: the model was consulted and its
        // answer did not survive. Either our rules were right and the
        // precedence saved a booking, or they were wrong and this is a
        // bug report.
        overruled: r.route !== "" && model !== "—" && model !== final,
      };
    }),
  };
}

export async function getBookingBotPerformance(): Promise<BotPerformance> {
  await requireBotAdmin();

  const [latencies, rejectRows, recent] = await Promise.all([
    db.bookingBotLog.findMany({
      where: { NOT: { latencyMs: null } },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { latencyMs: true },
    }),
    db.bookingBotLog.groupBy({
      by: ["rejected"],
      where: { NOT: { rejected: null } },
      _count: { rejected: true },
    }),
    db.bookingBotLog.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 14 * 86400000) } },
      select: { createdAt: true, route: true },
    }),
  ]);

  // Percentiles in JS over a bounded sample rather than in SQL: 500 rows
  // is nothing to sort, and it keeps this working on any Postgres
  // without a percentile extension.
  const ms = latencies
    .map((l) => l.latencyMs ?? 0)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const at = (q: number) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(ms.length * q))] : null);

  const byDay = new Map<string, { total: number; viaModel: number }>();
  for (const r of recent) {
    // IST day, so the chart lines up with the venue's own day.
    const day = new Date(r.createdAt.getTime() + 330 * 60000).toISOString().slice(0, 10);
    const cur = byDay.get(day) ?? { total: 0, viaModel: 0 };
    cur.total += 1;
    if (r.route !== "") cur.viaModel += 1;
    byDay.set(day, cur);
  }

  return {
    p50: at(0.5),
    p95: at(0.95),
    slowest: ms.length ? ms[ms.length - 1] : null,
    rejections: rejectRows
      .map((r) => ({ reason: r.rejected ?? "unknown", count: r._count.rejected }))
      .sort((a, b) => b.count - a.count),
    daily: [...byDay.entries()]
      .map(([day, v]) => ({ day, ...v }))
      .sort((a, b) => a.day.localeCompare(b.day)),
  };
}
