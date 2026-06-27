import { request } from "./admin-api";

/** Tab a broadcast tap opens, mirroring the web "On tap, open" picker. */
export type PushScreen = "home" | "book" | "cafe" | "shop" | "rewards";

export interface PushReach {
  all: number;
  android: number;
  ios: number;
}

export interface RecentPushSend {
  id: string;
  /** PushKind: broadcast | open_screen | booking_confirmed | … */
  kind: string;
  /** "broadcast" | "test" */
  source: string;
  /** audience descriptor (all | ios | android | group | user) */
  audience: string | null;
  title: string;
  body: string;
  attempted: number;
  succeeded: number;
  failed: number;
  createdAt: string;
}

export interface PushOverview {
  reach: PushReach;
  recent: RecentPushSend[];
}

export interface SendPushInput {
  title: string;
  body: string;
  /** Omit to just open the app with no specific destination. */
  screen?: PushScreen;
}

export interface SendPushResult {
  ok: true;
  attempted: number;
  succeeded: number;
  failed: number;
  cleanedUp: number;
}

export const adminPushApi = {
  overview: () =>
    request<PushOverview>("/api/mobile/admin/push", { method: "GET" }),
  send: (body: SendPushInput) =>
    request<SendPushResult>("/api/mobile/admin/push/send", {
      method: "POST",
      body,
    }),
};
