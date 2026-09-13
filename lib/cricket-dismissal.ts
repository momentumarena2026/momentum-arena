/**
 * How a batter got out, in the tournament scorer's vocabulary.
 *
 * This file is now an ADAPTER, not a second rulebook. Tournament events
 * store lowercase strings ("runout") and were written that way long before
 * lib/cricket-rules.ts existed; every stored event has to keep folding the
 * same, so the wire format stays. What changed is that the questions —
 * does the bowler get this? can it have happened off that delivery? — are
 * answered by the shared Laws module rather than restated here, which is
 * how the casual engine and this one came to disagree.
 */
import {
  creditsBowler as creditsBowlerRule,
  type WicketKind,
} from "@/lib/cricket-rules";

/** The kinds a scorer can record. Anything else is refused, not stored. */
export const DISMISSALS = [
  "bowled",
  "caught",
  "lbw",
  "stumped",
  "runout",
  "hitwicket",
  // The rare four, added when the engine was audited against the Laws.
  // All ten methods are now recordable, so a scorecard can say how a
  // batter went instead of falling back to "out".
  "obstructing",
  "hitballtwice",
  "timedout",
  "retiredout",
] as const;

/** The stored string, as the shared Laws module names it. */
const AS_KIND: Record<string, WicketKind> = {
  bowled: "BOWLED",
  caught: "CAUGHT",
  lbw: "LBW",
  stumped: "STUMPED",
  runout: "RUN_OUT",
  hitwicket: "HIT_WICKET",
  obstructing: "OBSTRUCTING_FIELD",
  hitballtwice: "HIT_BALL_TWICE",
  timedout: "TIMED_OUT",
  retiredout: "RETIRED_OUT",
};

export function toWicketKind(d: string | null | undefined): WicketKind {
  return (d && AS_KIND[d]) || "OTHER";
}

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
  return creditsBowlerRule(toWicketKind(dismissal));
}

/** Does this kind involve a fielder the scorer should name? */
export function needsFielder(dismissal: string | null | undefined): boolean {
  return dismissal === "caught" || dismissal === "stumped" || dismissal === "runout";
}

/** Only a run out can take the batter at the other end. */
export function needsEnd(dismissal: string | null | undefined): boolean {
  return dismissal === "runout";
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
    case "obstructing":
      return "obstructing the field";
    case "hitballtwice":
      return "hit the ball twice";
    case "timedout":
      return "timed out";
    case "retiredout":
      return "retired out";
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
