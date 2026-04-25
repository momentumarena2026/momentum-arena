import { api } from "./api";
import type { CafeItem } from "./types";

export const cafeApi = {
  items: () => api.get<CafeItem[]>("/api/mobile/cafe/items"),
};
