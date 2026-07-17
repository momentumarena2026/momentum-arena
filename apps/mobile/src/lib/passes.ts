import { api } from "./api";

/** Mirrors lib/passes.listUserPasses on the server — one shape for web
 *  and mobile so the surfaces never drift. */
export interface MyPassSummary {
  id: string;
  name: string;
  sport: string;
  totalMinutes: number;
  remainingMinutes: number;
  bandsSummary: string;
  purchasedAt: string;
  startsAt: string;
  expiresAt: string;
  status: "ACTIVE" | "UPCOMING" | "EXHAUSTED" | "EXPIRED" | "CANCELLED";
  role: "owner" | "member";
  ownerName: string | null;
  redemptions: { minutes: number; createdAt: string; restored: boolean }[];
}

export const passesApi = {
  myPasses: () =>
    api.get<{ passes: MyPassSummary[]; storefrontEnabled: boolean }>(
      "/api/mobile/passes",
    ),
};
