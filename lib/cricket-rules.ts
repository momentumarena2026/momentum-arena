/**
 * The Laws of Cricket, as this codebase understands them.
 *
 * ONE implementation, deliberately. Cricket was scored twice here — a
 * casual-match engine and a tournament fold that shared no code — and the
 * two drifted exactly where you would expect: a run out resolved the ends
 * correctly in one and not the other, the rare dismissals paid the bowler
 * in both, and a fix to either left the other wrong. Every rule that
 * decides who is out, who faces next, whose column a run lands in and
 * whether a ball counts now lives here and nowhere else.
 *
 * Pure by construction: no database, no state shape, no player model. The
 * callers hold players as names (casual matches) or as member ids
 * (tournaments); these functions only ever compare and return the keys
 * they were given, which is what lets both use them.
 */

export type WicketKind =
  | "BOWLED"
  | "CAUGHT"
  | "LBW"
  | "RUN_OUT"
  | "STUMPED"
  | "HIT_WICKET"
  | "OBSTRUCTING_FIELD"
  | "HIT_BALL_TWICE"
  | "TIMED_OUT"
  | "RETIRED_OUT"
  | "OTHER";

/** All ten methods in the Laws, in the order a scorer looks for them. */
export const WICKET_KINDS: WicketKind[] = [
  "BOWLED",
  "CAUGHT",
  "LBW",
  "RUN_OUT",
  "STUMPED",
  "HIT_WICKET",
  "OBSTRUCTING_FIELD",
  "HIT_BALL_TWICE",
  "TIMED_OUT",
  "RETIRED_OUT",
  "OTHER",
];

/** What the bowler actually sent down. */
export type Delivery = "LEGAL" | "WIDE" | "NO_BALL";

/** Which end of the pitch, in terms of where the batters started the ball. */
export type CreaseEnd = "STRIKER" | "NON_STRIKER";

/**
 * Dismissals that are NOT the bowler's.
 *
 * An exclusion list rather than an allow-list on purpose: a wicket logged
 * with no kind at all has always counted for the bowler, and rewriting the
 * bowling figures of every match already played would be worse than the
 * ambiguity. Anything a scorer can actually NAME is classified correctly.
 */
const NOT_THE_BOWLERS: readonly WicketKind[] = [
  "RUN_OUT",
  "OBSTRUCTING_FIELD",
  "HIT_BALL_TWICE",
  "TIMED_OUT",
  "RETIRED_OUT",
];

export function creditsBowler(kind: WicketKind | null | undefined): boolean {
  return !NOT_THE_BOWLERS.includes(kind ?? "OTHER");
}

/** Only a run out can happen at the other end, or before the ball is bowled. */
export function canHappenAtEitherEnd(kind: WicketKind | null | undefined): boolean {
  return kind === "RUN_OUT";
}

/**
 * Does this delivery use up a ball in the over?
 *
 * Wides and no-balls are re-bowled. So is a Mankad, which is not a
 * delivery at all — the bowler never released it — and counting one ends
 * the over a ball early, robbing the batting side of a legal delivery.
 */
export function consumesBall(args: {
  delivery: Delivery;
  beforeDelivery?: boolean;
}): boolean {
  if (args.beforeDelivery) return false;
  return args.delivery === "LEGAL";
}

/** Is the striker charged with having faced it? Nobody faces a wide. */
export function isFaced(args: { delivery: Delivery; beforeDelivery?: boolean }): boolean {
  if (args.beforeDelivery) return false;
  return args.delivery !== "WIDE";
}

/** Every no-ball earns a free hit, and it carries across the end of an over. */
export function armsFreeHit(delivery: Delivery): boolean {
  return delivery === "NO_BALL";
}

/**
 * Where a delivery's runs belong.
 *
 * The split is the whole difficulty, because the same number means
 * different things ball to ball:
 *   legal    off the bat, to whoever faced it
 *   no-ball  off the bat too, plus a penalty run; anything that beat the
 *            bat is a no-ball extra and never the striker's
 *   wide     never off the bat — the penalty and every run they ran are
 *            all wides
 * The bowler concedes all of it either way, which byes and leg-byes alone
 * are exempt from.
 */
export function splitRuns(args: {
  delivery: Delivery;
  /** Runs off the bat. */
  runs?: number;
  /** Runs that beat the bat and were run anyway. */
  byes?: number;
}): {
  team: number;
  toStriker: number;
  toWideExtras: number;
  toNoBallExtras: number;
  toBowler: number;
  /** How far the batters actually ran — what decides whether they crossed. */
  ran: number;
} {
  const runs = clamp(args.runs ?? 0);
  const byes = clamp(args.byes ?? 0);
  if (args.delivery === "WIDE") {
    // A wide that beats the keeper is still all wides, however far they ran.
    const total = 1 + runs + byes;
    return {
      team: total,
      toStriker: 0,
      toWideExtras: total,
      toNoBallExtras: 0,
      toBowler: total,
      ran: runs + byes,
    };
  }
  if (args.delivery === "NO_BALL") {
    const total = 1 + runs + byes;
    return {
      team: total,
      toStriker: runs,
      toWideExtras: 0,
      toNoBallExtras: 1 + byes,
      toBowler: total,
      ran: runs + byes,
    };
  }
  return {
    team: runs,
    toStriker: runs,
    toWideExtras: 0,
    toNoBallExtras: 0,
    toBowler: runs,
    ran: runs,
  };
}

/** The batters change ends on an odd number of completed runs. */
export function crossed(ran: number): boolean {
  return ran % 2 === 1;
}

/**
 * Where the batters stand after a wicket.
 *
 * One rule covers every case: THE NEW BATTER TAKES THE END THE DISMISSAL
 * HAPPENED AT, and the survivor takes the other. That is why no extra
 * crossing is applied for an odd number of completed runs — the end of
 * dismissal already says where both of them finished up.
 *
 * The case this exists for: a striker run out at the NON-striker's end
 * must have crossed to be dismissed down there, so the survivor is at the
 * striker's end and faces next, while the new batter walks to the far end.
 * Resolving from the dismissed batter's own end instead — which both
 * engines used to do — put the wrong man on strike for the rest of the over.
 *
 * `outAtEnd` omitted means "their own end", which is what every wicket
 * logged before the field existed meant, and is right for every dismissal
 * except a run out where they crossed.
 */
export function endsAfterWicket<T extends string>(args: {
  striker: T | null;
  nonStriker: T | null;
  /** Who is out. Defaults to the striker. */
  outBatter?: T | null;
  outAtEnd?: CreaseEnd | null;
  /** Who walks in. Null leaves the dismissal end vacant. */
  newBatter?: T | null;
}): { striker: T | null; nonStriker: T | null } {
  const { striker, nonStriker } = args;
  const out = args.outBatter ?? striker;
  const outIsNonStriker = out === nonStriker;
  const survivor = outIsNonStriker ? striker : nonStriker;
  const end: CreaseEnd = args.outAtEnd ?? (outIsNonStriker ? "NON_STRIKER" : "STRIKER");
  const newAtStrikersEnd = end === "STRIKER";
  const incoming = args.newBatter ?? null;
  return newAtStrikersEnd
    ? { striker: incoming, nonStriker: survivor }
    : { striker: survivor, nonStriker: incoming };
}

/**
 * Why this dismissal cannot have happened off this delivery — or null.
 *
 * Three separate restrictions, all of them about what the bowler is
 * allowed to earn:
 *   free hit   nothing off the stumps; the batter is protected
 *   no-ball    likewise, and it is not even a legal delivery
 *   wide       a ball nobody could reach can still be stumped or hit
 *              wicket, but never caught — if they hit it, it was not wide
 */
export function dismissalRefusal(
  kind: WicketKind | null | undefined,
  ctx: { delivery?: Delivery; freeHit?: boolean; beforeDelivery?: boolean },
): string | null {
  const k = kind ?? "OTHER";
  // Unknown stays permitted: old logs carry no kind and must still replay.
  if (k === "OTHER") return null;
  const delivery = ctx.delivery ?? "LEGAL";

  if (ctx.beforeDelivery && k !== "RUN_OUT") {
    return "Only a run out can happen before the ball is delivered";
  }
  if (delivery === "NO_BALL") {
    if (!["RUN_OUT", "OBSTRUCTING_FIELD", "HIT_BALL_TWICE"].includes(k)) {
      return "A no-ball can only produce a run out, obstructing the field or hitting the ball twice";
    }
    return null;
  }
  if (delivery === "WIDE") {
    if (!["RUN_OUT", "STUMPED", "HIT_WICKET", "OBSTRUCTING_FIELD"].includes(k)) {
      return "A wide can only produce a run out, a stumping, hit wicket or obstructing the field";
    }
    return null;
  }
  // A free hit is consumed by a legal delivery, so this is the one that counts.
  if (ctx.freeHit && !["RUN_OUT", "OBSTRUCTING_FIELD", "HIT_BALL_TWICE"].includes(k)) {
    return "It's a free hit — only a run out, obstructing the field or hitting the ball twice";
  }
  return null;
}

/** Has this bowler used up their allocation? 0 or null means no limit. */
export function bowlerSpent(args: {
  ballsBowled: number;
  maxOvers?: number | null;
}): boolean {
  const cap = args.maxOvers ?? 0;
  if (cap <= 0) return false;
  return args.ballsBowled >= cap * 6;
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(7, Math.trunc(n)));
}
