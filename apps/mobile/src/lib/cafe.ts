import { api } from "./api";
import type { CafeItem } from "./types";

export interface CafeMenuResponse {
  /** Master open/closed switch from CafeSettings. When false the
   *  mobile cafe tab renders the "Cafe closed" view; when true it
   *  renders the menu (items list still populated either way). */
  isOpen: boolean;
  items: CafeItem[];
}

export const cafeApi = {
  /** Single round-trip for the cafe tab — server resolves the
   *  open/closed flag + the menu in one query. */
  menu: () => api.get<CafeMenuResponse>("/api/mobile/cafe/items"),
};
