import { api } from "./api";

/**
 * Quick book's feature switches.
 *
 * Public and unauthenticated: the home screen asks this before it knows
 * who is looking, and a signed-out customer sees the same entry point.
 *
 * `enabled` is a courtesy on this side — hiding the button. The real gate
 * is server-side in the booking-bot API, so an app holding a stale cache
 * still cannot reach a feature the venue has switched off.
 */
export type QuickBookConfig = {
  enabled: boolean;
  newBadge: boolean;
  betaBadge: boolean;
};

export async function fetchQuickBookConfig(): Promise<QuickBookConfig> {
  return api.get<QuickBookConfig>("/api/mobile/booking-bot/config", { auth: false });
}
