/**
 * Quick book's master switch and its two badges.
 *
 * Read on the customer path (the API gate, the app's home screen) and on
 * the admin path, so it lives here rather than inside either.
 *
 * The switch exists because this is the one feature in the app whose
 * behaviour depends on something outside this codebase. A provider can
 * retire a model overnight, a prompt can regress, an outage can slow
 * every reply — and the answer to any of those has to be faster than a
 * store release or even an OTA. Turning it off returns customers to the
 * ordinary slot picker, which is untouched and always works.
 */

import { db } from "@/lib/db";

export type QuickBookSettings = {
  enabled: boolean;
  newBadge: boolean;
  betaBadge: boolean;
};

/**
 * Fail OPEN on the read, closed on nothing.
 *
 * If the settings row cannot be read the feature stays on, because the
 * alternative — a transient database blip silently removing a booking
 * route — is worse than the blip. An admin turning it off is an explicit
 * act and that value is what gets cached below.
 */
const DEFAULTS: QuickBookSettings = { enabled: true, newBadge: true, betaBadge: true };

let cache: { at: number; value: QuickBookSettings } | null = null;
const TTL_MS = 30_000;

export async function getQuickBookSettings(): Promise<QuickBookSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const row = await db.arenaSettings.findFirst({
      select: {
        quickBookEnabled: true,
        quickBookNewBadge: true,
        quickBookBetaBadge: true,
      },
    });
    const value: QuickBookSettings = row
      ? {
          enabled: row.quickBookEnabled,
          newBadge: row.quickBookNewBadge,
          betaBadge: row.quickBookBetaBadge,
        }
      : DEFAULTS;
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return cache?.value ?? DEFAULTS;
  }
}

/**
 * Drop the cache so an admin toggle is visible immediately rather than
 * up to 30 seconds later. Called from the write path; a stale read
 * elsewhere in the fleet still self-corrects within the TTL.
 */
export function invalidateQuickBookSettings(): void {
  cache = null;
}
