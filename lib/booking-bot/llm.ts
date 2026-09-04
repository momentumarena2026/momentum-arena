/**
 * The comprehension layer for Quick book.
 *
 * ── Why this exists after arguing against it ─────────────────────────
 *
 * The rule parser handles the sentences it was written for and fails on
 * the rest, and "the rest" is not a finite list. Every new phrasing found
 * one more gap, each gap got a patch, and the next phrasing found the
 * next gap — a loop that only terminates if the input space is finite.
 * Natural language isn't. Rules cannot be the whole answer here.
 *
 * ── What this is allowed to do, and what it is not ───────────────────
 *
 * It TRANSLATES. It does not decide.
 *
 * Its entire output is the same {sport, date, hours} struct the rule
 * parser produces. It never sees a price, never picks a court, never
 * touches availability and never books. Everything downstream — the hold,
 * the price, the payment — is the existing, tested pipeline, unchanged.
 *
 * Every field it returns is re-validated server-side against the enums,
 * the booking horizon and the venue's operating hours before it reaches
 * anything real (see validate.ts). A value the model invents fails
 * validation and becomes a question, not a booking. That is the property
 * that makes a probabilistic component acceptable in front of a payment:
 * it can be wrong, but it cannot be wrong in a way that costs money.
 *
 * ── Privacy ─────────────────────────────────────────────────────────
 *
 * Only the message text and neutral context (today's date, the sport
 * list) are sent. No name, phone, email, user id or booking history ever
 * leaves this server. The prompt is assembled here and nowhere else so
 * that stays checkable in one place.
 *
 * ── Degradation ─────────────────────────────────────────────────────
 *
 * No key, a timeout, a rate limit or a malformed answer all resolve the
 * same way: return null, and the caller falls back to the rule parser's
 * reading. The model is an improvement on the fallback, never a
 * dependency of it — so an outage at the provider is a quality dip, not
 * an incident.
 */

import { Sport } from "@prisma/client";

/**
 * Free tier, low latency, and CONFIGURABLE on purpose.
 *
 * The first value tried here was llama-3.1-8b-instant, which Groq shut
 * down on 16 August 2026 — every call returned HTTP 404 and the feature
 * silently ran on rules alone. Providers retire models on their own
 * schedule, so the id lives in the environment: the next deprecation is
 * a Vercel setting change, not a code deploy and a wait for CI.
 *
 * Default is Groq's own named replacement for the 8B model.
 */
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Hard ceiling on the model call.
 *
 * The customer is watching a chat bubble. Past about two seconds the
 * feature feels broken, and the rule parser's answer — which we already
 * have in hand — is better than a slow one.
 */
const TIMEOUT_MS = 2500;

export type LlmReading = {
  sport: Sport | null;
  /** IST calendar day, "YYYY-MM-DD". */
  date: string | null;
  /** 24h venue-relative. Exclusive end. */
  startHour: number | null;
  endHour: number | null;
  courtSize: "HALF" | "FULL" | null;
  /**
   * The model's own read on whether it is sure.
   *
   * Acted on, not decorative: anything below "high" goes to a question
   * rather than a proposal. The venue's instruction was to always ask
   * before proposing when the message is only partly understood.
   */
  confidence: "high" | "low";
  /**
   * A question to put to the customer when the message is unclear, with
   * the options it should offer. This is the output that generalises —
   * it covers phrasings nobody enumerated, which is the whole reason the
   * model is here.
   */
  clarify: { question: string; options: string[] } | null;
  /**
   * Words the model resolved that our own vocabulary does not contain,
   * as {term, canonical}. Harvested into BookingBotTerm so the rule
   * parser can learn them and stop needing the model for that word.
   */
  learned: { term: string; canonical: string }[];
};

function systemPrompt(todayIst: string, weekdayIst: string): string {
  // Deliberately terse and closed-world. Every instruction that narrows
  // the output narrows what validation has to reject.
  return [
    "You extract booking details from one message for an Indian sports venue.",
    "",
    `Today is ${todayIst} (${weekdayIst}), Asia/Kolkata. The venue opens 05:00 and closes 01:00.`,
    "Sports: CRICKET, FOOTBALL, PICKLEBALL. Nothing else exists.",
    "Cricket has a full turf and two half courts; football has a full field and halves.",
    "",
    "Return ONLY a JSON object with these keys:",
    '  sport: "CRICKET" | "FOOTBALL" | "PICKLEBALL" | null',
    '  date: "YYYY-MM-DD" | null   (resolve relative days against today)',
    "  startHour: 0-25 | null      (24h; 24/25 mean after midnight)",
    "  endHour: 0-25 | null        (exclusive; 19-20 is one 7-8pm hour)",
    '  courtSize: "HALF" | "FULL" | null',
    '  confidence: "high" | "low"',
    '  clarify: { "question": string, "options": string[] } | null',
    '  learned: [{ "term": string, "canonical": string }]',
    "",
    "Rules:",
    "- Bare hours mean PM unless stated (7 means 19:00). Evening 18:00, morning 08:00, night 21:00.",
    "- Understand Hinglish: kal=tomorrow, aaj=today, shaam=evening, subah=morning, aadha=half.",
    '- If the message is unclear or you had to guess, set confidence "low" and write a clarify question.',
    "- clarify.options must be short, tappable answers (max 4).",
    "- learned: any non-obvious word you resolved, mapped to a plain English equivalent. Else [].",
    "- Never invent a price, a court name, or availability. You do not know what is free.",
  ].join("\n");
}

/**
 * Ask the model to read one message. Null on any failure at all.
 *
 * `context` is what the conversation already established, so a reply like
 * "no, make it half court" is readable — the same reason mergeParsed
 * exists on the rule path.
 */
export async function readWithLlm(
  text: string,
  opts: {
    todayIst: string;
    weekdayIst: string;
    context?: Record<string, unknown> | null;
  },
): Promise<{ reading: LlmReading | null; latencyMs: number; raw: unknown }> {
  const key = process.env.GROQ_API_KEY;
  // Absent key is a normal state, not an error: the feature ships and
  // runs on rules alone until the key is set.
  if (!key) return { reading: null, latencyMs: 0, raw: null };

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const userContent = opts.context
      ? `Message: ${text}\nAlready established: ${JSON.stringify(opts.context)}`
      : `Message: ${text}`;

    const res = await fetch(GROQ_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        // Deterministic: the same sentence must not price differently on
        // two tries, and there is nothing creative to do here.
        temperature: 0,
        max_tokens: 400,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt(opts.todayIst, opts.weekdayIst) },
          { role: "user", content: userContent },
        ],
      }),
    });

    const latencyMs = Date.now() - started;
    if (!res.ok) {
      // The BODY, not just the status. "HTTP 404" alone said nothing
      // about whether the url, the key or the model id was wrong; the
      // body says "model does not exist" and names it. This string lands
      // in BookingBotLog.llmResult, which is where a failure gets
      // diagnosed.
      const detail = await res.text().catch(() => "");
      return {
        reading: null,
        latencyMs,
        raw: `HTTP ${res.status} ${GROQ_MODEL} ${detail.slice(0, 300)}`,
      };
    }

    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) return { reading: null, latencyMs, raw: body };

    // Parsed but NOT trusted. validate.ts is what decides whether any of
    // this is allowed near a booking.
    return { reading: JSON.parse(content) as LlmReading, latencyMs, raw: content };
  } catch (err) {
    return {
      reading: null,
      latencyMs: Date.now() - started,
      raw: err instanceof Error ? err.name : "error",
    };
  } finally {
    clearTimeout(timer);
  }
}
