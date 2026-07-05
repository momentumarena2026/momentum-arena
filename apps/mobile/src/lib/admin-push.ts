import { request } from "./admin-api";

/** Tab a broadcast tap opens, mirroring the web "On tap, open" picker. */
export type PushScreen = "home" | "book" | "cafe" | "shop" | "rewards";

export interface PushReach {
  all: number;
  android: number;
  ios: number;
}

/** A targetable user-group cohort (same model coupons use). */
export interface PushGroupOption {
  id: string;
  name: string;
  memberCount: number;
  /** How many members have at least one registered push device. */
  deviceCount: number;
}

/** A customer matched by the "specific user" audience search. */
export interface PushUserMatch {
  id: string;
  name: string | null;
  phone: string | null;
  deviceCount: number;
  platforms: string[];
}

export interface RecentPushSend {
  id: string;
  /** PushKind: broadcast | open_screen | booking_confirmed | … */
  kind: string;
  /** "broadcast" | "test" */
  source: string;
  /** audience descriptor (all | ios | android | group | user | self) */
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
  /** Devices idle 90+ days — drives the prune-stale CTA. */
  staleDevices: number;
  groups: PushGroupOption[];
  recent: RecentPushSend[];
}

/**
 * Audience selector, mirroring the web broadcast form's discriminated
 * union. "all" / "platform" need no extra picker; "group" / "user" carry
 * the chosen id.
 */
export type PushAudience =
  | { kind: "all" }
  | { kind: "platform"; platform: "android" | "ios" }
  | { kind: "group"; groupId: string }
  | { kind: "user"; userId: string };

export interface SendPushInput {
  audience: PushAudience;
  title: string;
  body: string;
  /** Omit to just open the app with no specific destination. */
  screen?: PushScreen;
  /** Preview the recipient count without actually sending. */
  dryRun?: boolean;
}

export interface SendPushResult {
  ok: true;
  /** True when this was a dry-run reach preview (nothing was sent). */
  dryRun?: boolean;
  attempted: number;
  succeeded: number;
  failed: number;
  cleanedUp: number;
}

/** A registered customer device row (token masked server-side). */
export interface PushDevice {
  id: string;
  platform: string;
  appVersion: string | null;
  tokenPreview: string;
  lastSeenAt: string;
  createdAt: string;
  userId: string;
  userName: string | null;
  userPhone: string | null;
}

export interface PushDevicesPage {
  devices: PushDevice[];
  total: number;
  page: number;
  totalPages: number;
}

/** One placeholder an automated template's copy may reference, e.g. {name}. */
export interface PushTemplateVariable {
  name: string;
  description: string;
  example: string;
}

/**
 * An automated (event-triggered) push template: the code registry entry
 * merged with any DB override — mirrors the web dashboard's view model.
 * `title`/`body` are the EFFECTIVE values (override ?? default).
 */
export interface PushTemplateView {
  key: string;
  audience: "customer" | "admin";
  label: string;
  trigger: string;
  defaultTitle: string;
  defaultBody: string;
  variables: PushTemplateVariable[];
  enabled: boolean;
  title: string;
  body: string;
  isCustomized: boolean;
  updatedAt: string | null;
}

export interface UpdatePushTemplateInput {
  key: string;
  enabled?: boolean;
  /** Sending copy equal to the default clears the override server-side. */
  title?: string;
  body?: string;
}

function qs(params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export const adminPushApi = {
  overview: () =>
    request<PushOverview>("/api/mobile/admin/push", { method: "GET" }),

  /** Search customers for the "specific user" audience (min 2 chars). */
  searchUsers: (q: string) =>
    request<{ users: PushUserMatch[] }>(
      `/api/mobile/admin/push/users${qs({ q })}`,
      { method: "GET" },
    ).then((r) => r.users),

  send: (body: SendPushInput) =>
    request<SendPushResult>("/api/mobile/admin/push/send", {
      method: "POST",
      body,
    }),

  /**
   * Test-push to the current admin's OWN device(s) only. Optionally
   * carries the composed title/body so the admin previews the real copy.
   */
  testToSelf: (override?: { title?: string; body?: string }) =>
    request<SendPushResult>("/api/mobile/admin/push/test", {
      method: "POST",
      body: override ?? {},
    }),

  devices: (opts?: { platform?: string; page?: number; limit?: number }) =>
    request<PushDevicesPage>(
      `/api/mobile/admin/push/devices${qs({
        platform: opts?.platform,
        page: opts?.page,
        limit: opts?.limit,
      })}`,
      { method: "GET" },
    ),

  /** Revoke (unregister) a single customer device token. */
  revokeDevice: (id: string) =>
    request<{ ok: true; deleted: number }>("/api/mobile/admin/push/devices", {
      method: "DELETE",
      body: { id },
    }),

  /** Bulk-prune customer devices idle 90+ days. */
  pruneStale: () =>
    request<{ ok: true; deleted: number }>("/api/mobile/admin/push/devices", {
      method: "DELETE",
      body: { pruneStale: true },
    }),

  /** Automated (event-triggered) template registry merged with overrides. */
  templates: () =>
    request<{ templates: PushTemplateView[] }>(
      "/api/mobile/admin/push/templates",
      { method: "GET" },
    ),

  /**
   * Toggle / re-copy one automated template. Returns the refreshed full
   * list so callers can setQueryData without a follow-up GET.
   */
  updateTemplate: (input: UpdatePushTemplateInput) =>
    request<{ templates: PushTemplateView[] }>(
      "/api/mobile/admin/push/templates",
      { method: "POST", body: input },
    ),
};
