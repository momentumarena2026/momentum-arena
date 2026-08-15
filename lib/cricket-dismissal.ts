/**
 * How a batter got out — the one place that decides both whether the
 * bowler is credited and how the scorecard line reads.
 *
 * Kept pure and separate because the two questions are answered in
 * different files (the fold credits figures, the match centre renders
 * the line) and they must not drift: a dismissal the fold treats as the
 * bowler's while the card prints "run out" is a contradiction the
 * scorer can see.
 */

/** The kinds a scorer can record. Anything else is refused, not stored. */
export const DISMISSALS = [
  "bowled",
  "caught",
  "lbw",
  "stumped",
  "runout",
  "hitwicket",
] as const;

export type Dismissal = (typeof DISMISSALS)[number];

export function isDismissal(v: unknown): v is Dismissal {
  return typeof v === "string" && (DISMISSALS as readonly string[]).includes(v);
}

/**
 * Does this wicket go on the bowler's figures?
 *
 * A run-out doesn't: nobody bowled the batter out, the fielding side ran
 * them out, and crediting it inflates both the bowler's analysis and the
 * Most Wickets leaderboard the tournament awards a trophy for.
 *
 * An unknown/absent kind DOES credit, deliberately. Deliveries logged
 * before dismissals were recorded carry no kind, and every one of them
 * was already counted; treating them as uncredited now would silently
 * rewrite bowling figures in matches that are already finished.
 */
export function creditsBowler(dismissal: string | null | undefined): boolean {
  return dismissal !== "runout";
}

/** Does this kind involve a fielder the scorer should name? */
export function needsFielder(dismissal: string | null | undefined): boolean {
  return dismissal === "caught" || dismissal === "stumped" || dismissal === "runout";
}

/**
 * The scorecard line: "c Patel b Khan", "lbw b Khan", "run out (Patel)".
 *
 * Names are optional throughout, and that is the point — matches scored
 * before the fielder was captured have nothing to put in the brackets.
 * Each branch degrades to the shortest TRUE statement rather than
 * printing "c — b —", which claims a catcher we never recorded.
 */
export function dismissalLine(args: {
  dismissal: string | null | undefined;
  bowlerName?: string | null;
  fielderName?: string | null;
}): string {
  const { dismissal, bowlerName, fielderName } = args;
  const b = bowlerName?.trim() || null;
  const f = fielderName?.trim() || null;
  const bowledBy = b ? `b ${b}` : null;

  switch (dismissal) {
    case "runout":
      // No bowler credit, so no bowler in the line either.
      return f ? `run out (${f})` : "run out";
    case "caught":
      // Caught and bowled by the same player has its own notation.
      if (f && b && f === b) return `c & b ${b}`;
      if (f && b) return `c ${f} b ${b}`;
      if (b) return `c b ${b}`;
      return "caught";
    case "stumped":
      if (f && b) return `st ${f} b ${b}`;
      if (b) return `st b ${b}`;
      return "stumped";
    case "lbw":
      return bowledBy ? `lbw ${bowledBy}` : "lbw";
    case "hitwicket":
      return bowledBy ? `hit wicket ${bowledBy}` : "hit wicket";
    case "bowled":
      return bowledBy ?? "bowled";
    default:
      // Older rows carry no kind at all: say who bowled if we know, and
      // otherwise just that they were out. Never invent a manner.
      return bowledBy ?? "out";
  }
}

/** Short form for the ball-by-ball feed: "OUT! run out (Patel)". */
export function dismissalCommentary(args: {
  dismissal: string | null | undefined;
  bowlerName?: string | null;
  fielderName?: string | null;
  batterName?: string | null;
}): string {
  const line = dismissalLine(args);
  const who = args.batterName ? `${args.batterName} ` : "";
  return `OUT! ${who}${line}`.trim();
}
