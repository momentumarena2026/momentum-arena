/**
 * Spelling tolerance for the booking bot.
 *
 * ── Why this is not an AI model ──────────────────────────────────────
 *
 * "book cricket for next turhsday 8-10 pm" failed, and the instinct is
 * that the parser needs to be smarter. It doesn't. Every word this bot
 * cares about comes from a CLOSED list: seven weekdays, three sports,
 * twelve months, a dozen keywords. That is roughly sixty words in total.
 * The parser was demanding exact matches against sixty known words —
 * which is not a comprehension problem, it's a missing edit-distance
 * check.
 *
 * Fuzzy matching against a closed list is safe in a way that fuzzy
 * matching against open text is not: the worst case is that "turhsday"
 * becomes the wrong weekday out of seven, and the bot says which one it
 * picked. A model would instead be free to invent a reading nobody typed,
 * and would do it behind a price quote.
 *
 * ── Why the correction is surfaced, never silent ─────────────────────
 *
 * Every substitution is returned so the bot can say "I read 'turhsday' as
 * Thursday". A correction the customer can see costs one tap when it is
 * wrong. A correction they cannot see books the wrong day.
 */

/**
 * Levenshtein distance, abandoned once it provably exceeds `max`.
 *
 * Two rows instead of a full matrix, and an early exit on the row
 * minimum — this runs per token per message, so it stays cheap even
 * though the vocabulary is small.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  // A length gap alone already exceeds the budget.
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * How wrong a word is allowed to be, by length.
 *
 * Scaled, because one wrong letter in a four-letter word is a different
 * kind of event from two wrong letters in "wednesday". Two is the ceiling
 * at every length: the reported "turhsday" is two edits from "thursday"
 * (insert an h, delete the stray one), and the other real-world typos
 * this has to catch — "wendesday", "pickelball", "tomorow" — are all
 * within two as well. Going to three buys nothing and costs precision,
 * since every extra unit of budget pulls more unrelated words into range.
 */
function budgetFor(word: string): number {
  return word.length <= 4 ? 1 : 2;
}

/**
 * One spelling the parser knows, and what it means.
 *
 * Aliases carry their canonical form so a tie can be judged on MEANING
 * rather than on spelling: "sat" and "saturday" are two entries but one
 * day, and treating that as an ambiguity would ask the customer to choose
 * between Saturday and Saturday.
 */
export type VocabEntry = { word: string; canonical: string };

/**
 * Every vocabulary word tied for closest, deduped by meaning.
 *
 * Returning the full tie rather than an arbitrary winner is the whole
 * point. "turhsday" is three edits from "thursday" AND three from
 * "tuesday" — a real ambiguity, and silently taking the first is how a
 * bot books Tuesday when you said Thursday. The caller turns a tie into a
 * question instead of a guess.
 */
export function closestMatches(word: string, vocabulary: VocabEntry[]): string[] {
  const max = budgetFor(word);
  let bestD = max + 1;
  let winners: string[] = [];

  for (const entry of vocabulary) {
    const d = editDistance(word, entry.word, max);
    if (d > max) continue;
    if (d < bestD) {
      bestD = d;
      winners = [entry.canonical];
    } else if (d === bestD && !winners.includes(entry.canonical)) {
      winners.push(entry.canonical);
    }
  }
  return winners;
}

/**
 * Words that must never be "corrected", in two groups.
 *
 * STRUCTURAL words are the dangerous ones. They are load-bearing inside
 * the parser's own multi-word phrases, and they sit close to vocabulary
 * words: "day" is ONE edit from "may". Without this list, "day after
 * tomorrow" was rewritten to "may after tomorrow", the
 * day-after-tomorrow branch stopped matching, and the bot quietly booked
 * tomorrow instead — a whole day wrong, from a spell-checker that was
 * supposed to help. The existing IST test caught it; the guard below is
 * what keeps it caught.
 *
 * FILLER is the ordinary case: "book" sits 1 edit from "box", "for" is 2
 * from "four". Filler is the most common thing in these messages, so it
 * is also the most likely thing to be mangled into a false reading.
 */
const FILLER = new Set([
  // Structural — parts of phrases parse.ts matches on directly.
  "day", "days", "after", "before", "night", "week", "weekend",
  "morning", "evening", "afternoon", "noon", "late", "early",
  "book", "booking", "want", "need", "get", "give", "please", "pls", "plz",
  "the", "a", "an", "for", "at", "on", "in", "of", "and", "or", "to", "with",
  "me", "my", "i", "we", "us", "our", "you", "can", "could", "would", "will",
  "is", "are", "do", "does", "any", "some", "one", "next", "this", "that",
  "am", "pm", "hr", "hrs", "hour", "hours", "min", "mins", "minutes",
  "court", "ground", "pitch", "field", "turf", "slot", "slots", "game",
  "play", "playing", "match", "session", "from", "till", "until", "upto",
  "chahiye", "karna", "karo", "hai", "ka", "ki", "ke",
  // Chat noise. Not correcting these matters less than not ESCALATING on
  // them — the route treats an unrecognised word as a reason to ask for a
  // second opinion, and "yaar" is not a reason to spend a model call.
  "lets", "let", "yaar", "yar", "bhai", "bro", "dude", "sir", "maam",
  "thanks", "thank", "okay", "cool", "nice", "good", "sure", "yes", "no",
  "actually", "instead", "make", "change", "also", "just", "only", "still",
]);

export type Correction = { from: string; to: string };

/** A word that matched several vocabulary entries equally well. */
export type Ambiguity = { word: string; options: string[] };

export type SpellcheckResult = {
  /** The message with recognised misspellings replaced. */
  text: string;
  /** Every substitution made, for the bot to say out loud. */
  corrections: Correction[];
  /**
   * Content words that matched nothing, exactly or fuzzily.
   *
   * The point of collecting these is the reply. "Tell me which day" is a
   * useless answer to a message that already named a day the parser could
   * not read — it gives the customer no idea what went wrong. Naming the
   * word that confused it ("I didn't understand 'thrsdy'") tells them
   * exactly what to retype.
   */
  unknown: string[];
  /**
   * Words that matched two or more vocabulary entries equally well.
   *
   * This is the case the bot must ASK about rather than resolve. It is
   * not a rare corner: "turhsday" is exactly three edits from both
   * "thursday" and "tuesday", so the reported message lands here. Picking
   * one and booking it would be the worst available behaviour — the
   * customer sees a confident answer on the wrong day.
   */
  ambiguous: Ambiguity[];
};

/**
 * Fix what can be fixed, ask about what is genuinely unclear, and report
 * the rest.
 *
 * Only alphabetic tokens are considered — digits, times and dates are the
 * other parsers' business, and edit distance on numbers is meaningless
 * ("7" is one edit from "8").
 */
export function spellcheck(text: string, vocabulary: VocabEntry[]): SpellcheckResult {
  const corrections: Correction[] = [];
  const unknown: string[] = [];
  const ambiguous: Ambiguity[] = [];
  const vocab = new Set(vocabulary.map((v) => v.word));

  const fixed = text.replace(/[a-z]+/gi, (token) => {
    const lower = token.toLowerCase();
    if (vocab.has(lower) || FILLER.has(lower)) return token;
    // Below FOUR letters there is not enough signal to CORRECT safely.
    // Three-letter words are one edit from half the vocabulary — "day"
    // reaches "may", "not" reaches "nov" — and rewriting those does more
    // damage than leaving them alone.
    //
    // But not correcting is different from not noticing. "Book cricket
    // next San 1-2" proposed TODAY: "San" was three letters, so it was
    // skipped without a word, and the bot went on to say "assuming
    // today" as though no day had been named at all. Short unreadable
    // words are reported even though they are never rewritten.
    if (lower.length < 4) {
      if (lower.length === 3) unknown.push(token);
      return token;
    }

    const matches = closestMatches(lower, vocabulary);
    if (matches.length === 1) {
      corrections.push({ from: token, to: matches[0] });
      return matches[0];
    }
    if (matches.length > 1) {
      // Left in the text unchanged. It will not parse, so the field stays
      // missing and the bot asks — which is the correct outcome.
      ambiguous.push({ word: token, options: matches });
      return token;
    }
    unknown.push(token);
    return token;
  });

  return { text: fixed, corrections, unknown, ambiguous };
}
