import { Platform } from "react-native";
import { env } from "../config/env";
import { tokenStorage } from "./storage";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/**
 * Connectivity, inferred from request outcomes.
 *
 * Deliberately NOT @react-native-community/netinfo: that is a native
 * module, so adding it would change the runtime fingerprint and this
 * fix could only reach users through a new store build. Every request
 * already reports a reachability failure as ApiError(status 0), so the
 * signal is here for free and ships over OTA.
 *
 * Trade-off: this is reactive — we learn we're offline when something
 * tries to fetch, not the instant the radio drops. Screens fetch on
 * mount/focus and react-query retries, so in practice it surfaces
 * within a second or two of the user doing anything.
 */
let online = true;
const connectivityListeners = new Set<(v: boolean) => void>();

function setOnline(next: boolean) {
  if (online === next) return;
  online = next;
  for (const fn of connectivityListeners) fn(next);
}

export function isOnline() {
  return online;
}

export function subscribeConnectivity(fn: (v: boolean) => void): () => void {
  connectivityListeners.add(fn);
  // Explicit void body — Set.delete returns a boolean, which useEffect
  // rejects as a cleanup function.
  return () => {
    connectivityListeners.delete(fn);
  };
}

// Global 401 handler — registered by AuthProvider so any stale-token response
// (e.g. when we switch backends or the token is revoked server-side)
// transparently signs the user out instead of leaving them stuck on a
// "Couldn't load…" screen with no obvious recovery path.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

type Json = Record<string, unknown> | unknown[] | string | number | boolean;

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: Json;
  /** Send the Authorization header even if a token exists. Default: true. */
  auth?: boolean;
  signal?: AbortSignal;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true, signal } = opts;
  const url = `${env.apiUrl}${path}`;

  const headers: Record<string, string> = {
    Accept: "application/json",
    // Tells the server which mobile platform the request originated from.
    // Read by `getMobilePlatform()` in `lib/mobile-auth.ts` — currently
    // surfaced on Booking.platform for funnel analytics, but available
    // for any other route that wants to split iOS vs Android behavior.
    "X-Platform": Platform.OS === "ios" ? "ios" : "android",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  if (auth) {
    const token = await tokenStorage.read();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // The fetch never completed — no route to the server. An aborted
    // request is the caller navigating away, not a dead connection.
    if (!(err instanceof Error && err.name === "AbortError")) {
      setOnline(false);
    }
    throw new ApiError(
      `Network error reaching ${url}: ${err instanceof Error ? err.message : String(err)}`,
      0,
      null
    );
  }

  // Any completed response — even a 500 — proves we can reach the network.
  setOnline(true);

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await res.json().catch(() => null) : await res.text();

  if (!res.ok) {
    const errMsg =
      (typeof payload === "object" && payload && "error" in payload
        ? String((payload as { error: unknown }).error)
        : null) || `Request failed with ${res.status}`;

    // Best-effort global sign-out on 401s that actually sent a token — a 401
    // on a public-by-default endpoint shouldn't kick a signed-in user out.
    if (res.ok === false && res.status === 401 && headers.Authorization) {
      onUnauthorized?.();
    }

    throw new ApiError(errMsg, res.status, payload);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...opts, method: "GET" }),
  post: <T>(path: string, body?: Json, opts?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...opts, method: "POST", body }),
  patch: <T>(path: string, body?: Json, opts?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...opts, method: "PATCH", body }),
  put: <T>(path: string, body?: Json, opts?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...opts, method: "PUT", body }),
  delete: <T>(path: string, opts?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...opts, method: "DELETE" }),
};
