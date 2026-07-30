import { api } from "./api";

/**
 * Home-page Information Bar — same `/api/info-bar` the website renders,
 * resolved server-side (admin toggle + custom copy with the new-user
 * offer as fallback), so both surfaces always show identical text.
 */
export interface InfoBarState {
  show: boolean;
  text: string;
}

export const infoBarApi = {
  /** Public endpoint — no auth token needed. */
  get: () => api.get<InfoBarState>("/api/info-bar", { auth: false }),
};
