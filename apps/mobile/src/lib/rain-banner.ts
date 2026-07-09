import { api } from "./api";

/**
 * Shape returned by the web `/api/rain-banner` route — the same
 * `getRainBanner()` result the website renders. `show` is already
 * resolved server-side (AUTO weather check / ON / OFF), so the client
 * just paints the strip when `show` is true.
 */
export interface RainBannerState {
  show: boolean;
  title: string;
  body: string;
}

export const rainBannerApi = {
  /** Public endpoint — no auth token needed. */
  get: () => api.get<RainBannerState>("/api/rain-banner", { auth: false }),
};
