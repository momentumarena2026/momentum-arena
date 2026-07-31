import { db } from "@/lib/db";

/**
 * Canonical money derivation for a SlotHold checkout. Every payment path
 * (gateway initiate, DQR, UPI-QR commit, cash advance) must charge what
 * this file returns and nothing else.
 *
 * THE RULE
 *
 *   sessionSlots = hold.totalAmount                 // slot prices, ONE session
 *   seriesGross  = sessionSlots × count             // count = 1 unless recurring
 *   seriesNet    = seriesGross − recurring tier discount
 *   payable      = max(0, seriesNet − coupon − points + equipment)
 *
 * Coupon, points and rental gear are ONE-OFF: they come off the series
 * once, not once per session. That mirrors app/book/checkout/page.tsx +
 * checkout-client.tsx, which is where the number the customer agreed to
 * is drawn. `Booking.totalAmount` stays the SINGLE-session figure
 * (`sessionAmount`) — for a recurring series the whole payment is bundled
 * into the first booking's Payment row and the siblings are created
 * CONFIRMED with no payment of their own (actions/recurring-booking.ts).
 *
 * WHY THE CLIENT NUMBER IS STILL READ
 *
 * The recurring multiplier is not persisted anywhere on the SlotHold — it
 * only ever lived in the checkout URL params, and from there in the
 * client's `overrideAmount`. Deriving purely from the hold therefore
 * undercharges a series by a factor of `count`. So the client figure is
 * taken as a HINT, never as the charge: we re-derive every series total
 * that RecurringConfig actually permits and accept the client's number
 * only when it matches one of them exactly. A tampered client can pick a
 * series LENGTH (bounded by the admin's own min/max), never an amount.
 * Anything unexplained falls back to a single session and is flagged via
 * `clientAmountUnexplained` so the drift is visible in the logs.
 *
 * Callers that know the series length outright should pass `recurring`
 * instead — that path skips the inference entirely.
 */

/** The SlotHold columns every derivation here reads. */
export interface HoldAmountFields {
  totalAmount: number;
  equipmentTotalAmount?: number | null;
  couponId?: string | null;
  discountAmount?: number | null;
  pointsToRedeem?: number | null;
  pointsRedeemPaiseSaved?: number | null;
  // "Book via Pass + Pay" mode — the snapshotted coverage comes off the
  // court-time base before anything else is derived (see lib/passes.ts
  // setHoldPassMode). Parsed inline here to keep this module cycle-free.
  passModeId?: string | null;
  passModeCoverage?: unknown;
}

/** Court-time base for a hold: totalAmount minus any pass-mode coverage. */
export function holdCourtBase(hold: HoldAmountFields): number {
  if (!hold.passModeId) return hold.totalAmount;
  const cov = hold.passModeCoverage as { coveredAmount?: unknown } | null;
  const covered =
    cov && typeof cov === "object" && typeof cov.coveredAmount === "number"
      ? cov.coveredAmount
      : 0;
  return Math.max(0, hold.totalAmount - covered);
}

export interface HoldCharge {
  /** Full net payable for this checkout — the series total when recurring. */
  payableAmount: number;
  /** Single-session effective total; this is what Booking.totalAmount becomes. */
  sessionAmount: number;
  /** Sessions `payableAmount` covers. 1 for every non-recurring flow. */
  recurringCount: number;
  /** Series tier discount actually applied, as a percentage. */
  recurringDiscountPercent: number;
  /** The client sent an amount that matched no legal total, so it was ignored. */
  clientAmountUnexplained: boolean;
}

export interface DeriveHoldChargeOptions {
  /** Client-declared figure. A hint used to identify the series length only. */
  clientAmount?: number | null;
  /**
   * `clientAmount` is the 50% advance rather than the full payable — the
   * shape selectCashPayment / mobile select-payment use.
   */
  clientAmountIsAdvance?: boolean;
  /** Explicit series length, when a client sends one. Preferred over the hint. */
  recurring?: { mode?: string | null; count?: number | null } | null;
}

// actions/recurring-booking.ts hard-caps a weekly series at
// MAX_TOTAL_MONTHS * 4 weeks no matter what RecurringConfig allows.
// Charging past that would bill sessions the series never creates.
const MAX_SERIES_WEEKS = 12;

type Tier = { weeks?: number; days?: number; discountPercent: number };

interface SeriesRules {
  min: number;
  max: number;
  tiers: Tier[];
  key: "weeks" | "days";
}

function parseTiers(raw: unknown): Tier[] {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? (parsed as Tier[]) : [];
  } catch {
    return [];
  }
}

/**
 * Same tier lookup the slot picker uses to show the customer their
 * discount (slot-selection-client.tsx getDiscountForWeeks/Days): the
 * highest threshold the count reaches wins.
 */
function discountPercentFor(rules: SeriesRules, count: number): number {
  const applicable = rules.tiers
    .filter((t) => typeof t[rules.key] === "number" && count >= (t[rules.key] as number))
    .sort((a, b) => (b[rules.key] as number) - (a[rules.key] as number));
  const pct = applicable.length > 0 ? applicable[0].discountPercent : 0;
  return Number.isFinite(pct) && pct > 0 ? Math.min(pct, 100) : 0;
}

/** null when recurring is switched off — only a single session is then legal. */
async function loadSeriesRules(): Promise<{
  weekly: SeriesRules;
  daily: SeriesRules;
} | null> {
  const cfg = await db.recurringConfig.findFirst();
  if (!cfg || !cfg.enabled) return null;
  return {
    weekly: {
      min: cfg.minWeeks,
      max: Math.min(cfg.maxWeeks, MAX_SERIES_WEEKS),
      tiers: parseTiers(cfg.tiers),
      key: "weeks",
    },
    daily: {
      min: cfg.minDays,
      max: cfg.maxDays,
      tiers: parseTiers(cfg.dailyTiers),
      key: "days",
    },
  };
}

/**
 * Split a payable into the 50%-now / rest-at-venue pair. Ceil on the
 * advance so the venue never has to collect a fraction of a rupee.
 */
export function splitAdvancePayment(payableAmount: number): {
  advanceAmount: number;
  remainingAmount: number;
} {
  const advanceAmount = Math.ceil(payableAmount * 0.5);
  return { advanceAmount, remainingAmount: payableAmount - advanceAmount };
}

export async function deriveHoldCharge(
  hold: HoldAmountFields,
  opts: DeriveHoldChargeOptions = {},
): Promise<HoldCharge> {
  const appliedDiscount =
    hold.couponId && hold.discountAmount && hold.discountAmount > 0
      ? hold.discountAmount
      : 0;
  const pointsRedeemRupees =
    hold.pointsToRedeem && hold.pointsRedeemPaiseSaved
      ? Math.floor(hold.pointsRedeemPaiseSaved / 100)
      : 0;
  const equipmentTotalRupees = hold.equipmentTotalAmount ?? 0;
  // Applied to the whole checkout exactly once, however many sessions it covers.
  const oneOff = equipmentTotalRupees - appliedDiscount - pointsRedeemRupees;

  const courtBase = holdCourtBase(hold);
  const totalFor = (count: number, pct: number) => {
    const gross = courtBase * count;
    const tierDiscount = pct > 0 ? Math.round((gross * pct) / 100) : 0;
    return Math.max(0, gross - tierDiscount + oneOff);
  };

  const sessionAmount = totalFor(1, 0);
  const single: HoldCharge = {
    payableAmount: sessionAmount,
    sessionAmount,
    recurringCount: 1,
    recurringDiscountPercent: 0,
    clientAmountUnexplained: false,
  };

  if (hold.passModeId) return single;

  const explicitCount =
    typeof opts.recurring?.count === "number" && opts.recurring.count > 1
      ? Math.trunc(opts.recurring.count)
      : null;
  const clientAmount =
    typeof opts.clientAmount === "number" && opts.clientAmount > 0
      ? opts.clientAmount
      : null;

  // Nothing suggests a series. A hint at or below the single-session
  // charge can never describe one (admin discounts are capped at 50%, so
  // two sessions always cost at least one), so skip the config read.
  const singleHint = opts.clientAmountIsAdvance
    ? splitAdvancePayment(sessionAmount).advanceAmount
    : sessionAmount;
  if (!explicitCount && (clientAmount === null || clientAmount <= singleHint)) {
    return single;
  }

  const rules = await loadSeriesRules();
  if (!rules) {
    // Recurring switched off admin-side: a single session is the only
    // legal charge, whatever the client believes.
    return {
      ...single,
      clientAmountUnexplained: clientAmount !== null || explicitCount !== null,
    };
  }

  const matchesHint = (total: number) => {
    const asCharged = opts.clientAmountIsAdvance
      ? splitAdvancePayment(total).advanceAmount
      : total;
    return asCharged === clientAmount;
  };

  const mode = opts.recurring?.mode === "daily" ? "daily" : opts.recurring?.mode === "weekly" ? "weekly" : null;
  // Without an explicit mode we can't tell weekly from daily, so try both.
  const candidates = mode
    ? [mode === "daily" ? rules.daily : rules.weekly]
    : [rules.weekly, rules.daily];

  for (const r of candidates) {
    const floor = Math.max(2, r.min);
    if (explicitCount !== null) {
      // A count outside the admin's own bounds is rejected outright rather
      // than clamped — clamping would charge a total the customer never saw.
      if (explicitCount < floor || explicitCount > r.max) continue;
      const pct = discountPercentFor(r, explicitCount);
      return {
        payableAmount: totalFor(explicitCount, pct),
        sessionAmount,
        recurringCount: explicitCount,
        recurringDiscountPercent: pct,
        clientAmountUnexplained: false,
      };
    }
    // Descending: two counts can only tie on an exact match, so the charge
    // is the same either way and the longer one is the safer label.
    for (let count = r.max; count >= floor; count--) {
      const pct = discountPercentFor(r, count);
      const total = totalFor(count, pct);
      if (matchesHint(total)) {
        return {
          payableAmount: total,
          sessionAmount,
          recurringCount: count,
          recurringDiscountPercent: pct,
          clientAmountUnexplained: false,
        };
      }
    }
  }

  // Nothing legal explains what the client asked for. Charge the single
  // session we can prove — never the client's number — and let the caller
  // log it. Falling back rather than erroring is deliberate: clients do
  // drift (e.g. the app's points state lags the hold right after a
  // redemption), and charging our own derivation is right in that case
  // too. Only a genuine series is under-collected here, and only when the
  // recurring config changed mid-checkout.
  return {
    ...single,
    clientAmountUnexplained: clientAmount !== null || explicitCount !== null,
  };
}
