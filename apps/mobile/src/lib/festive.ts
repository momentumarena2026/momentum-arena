import { api } from "./api";

/**
 * Shape returned by the web `/api/festive-theme` route — the same
 * `getFestiveTheme()` the website renders from, already resolved
 * server-side (AUTO window / ON / OFF). The app only has to look up the
 * id in its own copy of the palette.
 */
export interface FestiveThemeState {
  theme: string | null;
  greeting: string | null;
}

export const festiveApi = {
  /** Public endpoint — no auth token needed. */
  get: () => api.get<FestiveThemeState>("/api/festive-theme", { auth: false }),
};
