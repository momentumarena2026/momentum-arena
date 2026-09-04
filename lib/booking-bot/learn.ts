/**
 * How the system gets less dependent on the model over time.
 *
 * The goal the venue set is not "use an LLM"; it is "understand
 * customers, and owe a third party as little as possible for it". Those
 * pull in opposite directions unless something converts the model's
 * answers into knowledge we keep.
 *
 * Fine-tuning a model of our own is the obvious-sounding version of that
 * and the wrong shape: it needs thousands of labelled examples, GPU
 * training, and an inference host Vercel cannot provide, and the result
 * would be a second opaque component to debug. What actually works for a
 * domain this narrow is to harvest DETERMINISTIC artefacts:
 *
 *   1. A cache of normalised phrasings. Customers repeat themselves far
 *      more than they realise; a repeat costs nothing and takes no
 *      network call.
 *   2. A learned vocabulary. Every word the model resolves that our
 *      parser did not know is a candidate rule. Once approved, the rule
 *      parser handles that word forever, free, and the model is never
 *      asked about it again.
 *
 * Both are inspectable, testable and revertible — none of which is true
 * of weights. And the metric is honest and visible: the share of
 * messages answered with no model call at all, which should climb.
 */

import { db } from "@/lib/db";

/**
 * Cache key for a message.
 *
 * Lowercased, punctuation-stripped, whitespace-collapsed. Relative words
 * are deliberately LEFT IN and the key is scoped per-day by the caller,
 * because "tomorrow" means something different tomorrow — caching that
 * across days would serve yesterday's answer with confidence.
 */
export function normalizeMessage(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s:/~.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/**
 * A previously validated reading for this exact phrasing, same day.
 *
 * Only rows that produced a reading the customer went on to CONFIRM are
 * reused. An unconfirmed reading is a hypothesis: it was shown, and we
 * have no idea whether the customer accepted it or gave up. Replaying a
 * hypothesis as though it were knowledge is how a cache turns one bad
 * answer into a permanent one.
 */
export async function cachedReading(
  normalized: string,
  todayIst: string,
): Promise<unknown | null> {
  try {
    const hit = await db.bookingBotLog.findFirst({
      where: {
        normalized,
        confirmed: true,
        // Same IST day only — see normalizeMessage.
        createdAt: { gte: new Date(`${todayIst}T00:00:00.000Z`) },
      },
      orderBy: { createdAt: "desc" },
      select: { finalResult: true },
    });
    return hit?.finalResult ?? null;
  } catch {
    // The cache is an optimisation. Losing it must never cost a booking.
    return null;
  }
}

/**
 * Record one message. Never throws, never blocks the reply.
 *
 * Logging failure must not fail a booking, so every path here swallows.
 * The row is what makes tomorrow's parser better than today's; it is not
 * worth today's customer.
 */
export async function logMessage(entry: {
  userId: string | null;
  text: string;
  normalized: string;
  parserResult: unknown;
  llmResult: unknown;
  route: string;
  rejected: string | null;
  finalResult: unknown;
  latencyMs: number | null;
}): Promise<string | null> {
  try {
    const row = await db.bookingBotLog.create({
      data: {
        userId: entry.userId,
        text: entry.text.slice(0, 500),
        normalized: entry.normalized,
        parserResult: entry.parserResult as never,
        llmResult: entry.llmResult as never,
        route: entry.route,
        rejected: entry.rejected,
        finalResult: entry.finalResult as never,
        latencyMs: entry.latencyMs,
      },
      select: { id: true },
    });
    return row.id;
  } catch {
    return null;
  }
}

/**
 * Remember words the model resolved that we didn't know.
 *
 * Stored UNAPPROVED. An unreviewed vocabulary is just the model's
 * mistakes written down permanently, and a wrong mapping here is worse
 * than no mapping — it would make the rule parser confidently wrong
 * without a model call to blame. `seenCount` drives the review queue, so
 * the words customers actually use surface first.
 */
export async function rememberTerms(
  terms: { term: string; canonical: string }[],
): Promise<void> {
  for (const t of terms) {
    try {
      await db.bookingBotTerm.upsert({
        where: { term: t.term },
        create: { term: t.term, canonical: t.canonical },
        update: { seenCount: { increment: 1 } },
      });
    } catch {
      // Best effort, one term at a time so one bad row can't lose the rest.
    }
  }
}

/**
 * The approved learned vocabulary, for the rule parser to use.
 *
 * Cached in module scope for a minute: this is read on the hot path of
 * every Quick book message and the table changes at human speed. A stale
 * minute costs nothing; a query per message costs a round trip on the
 * path we are trying to keep free.
 */
let cache: { at: number; terms: { term: string; canonical: string }[] } | null = null;
const TTL_MS = 60_000;

export async function approvedTerms(): Promise<{ term: string; canonical: string }[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.terms;
  try {
    const rows = await db.bookingBotTerm.findMany({
      where: { approved: true },
      select: { term: true, canonical: true },
      take: 500,
    });
    cache = { at: Date.now(), terms: rows };
    return rows;
  } catch {
    return cache?.terms ?? [];
  }
}

/** Mark a message's reading as the one the customer actually booked. */
export async function markConfirmed(logId: string): Promise<void> {
  try {
    await db.bookingBotLog.update({ where: { id: logId }, data: { confirmed: true } });
  } catch {
    /* ground truth is valuable, not critical */
  }
}
