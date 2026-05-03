"use client";

/**
 * Client-side analytics session + queue.
 *
 * Two responsibilities:
 *  1. Owns the AnalyticsSession id in localStorage so anon-then-auth
 *     funnels are continuous. The id is rotated when the user signs
 *     out (so the *next* signed-in person on a shared browser doesn't
 *     pick up the previous owner's session).
 *  2. Buffers events client-side and flushes in batches so we don't
 *     fire one HTTP request per click. Flushes on:
 *       - 20 events queued (whichever comes first)
 *       - 10s timer
 *       - page hide / unload (via sendBeacon)
 *       - manual flush() (used after sign-in to re-stamp prior events)
 *
 * IMPORTANT: All trackXxx() calls in lib/analytics.ts ultimately
 * push into queueEvent() here. Don't call queueEvent() directly from
 * feature code — go through the typed trackXxx() helpers so the
 * event name + property contract stays grep-able.
 */

const SESSION_KEY = "ma_analytics_session_id";
const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_BATCH_SIZE = 20;

type EventCategory =
  | "BOOKING"
  | "PAYMENT"
  | "AUTH"
  | "CAFE"
  | "WAITLIST"
  | "NAVIGATION"
  | "ADMIN"
  | "ERROR"
  | "SYSTEM";

interface QueuedEvent {
  name: string;
  category?: EventCategory;
  properties?: Record<string, unknown>;
  occurredAt: string; // ISO — stamped when the user actually did the thing,
  // not when we get round to flushing. Important so an event that fires
  // at 14:23:07 and flushes at 14:23:17 still timelines correctly.
  pageUrl?: string;
}

let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;
let metaSent = false;

// ---------- Session id ----------

/**
 * Read the cached session id, or `null` if there isn't one yet (the
 * server creates one on the first event flush). Server may also
 * REPLACE the id on the response if it didn't recognize the cached
 * one — see {@link onFlushResponse}.
 */
export function getSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function setSessionId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SESSION_KEY, id);
  } catch {
    // Storage might be denied (Safari private mode etc.) — we just
    // operate in memory then. The server creates a fresh row on
    // every batch but events still land, just not cross-page.
  }
}

/**
 * Call from the sign-out flow so the next user on the same browser
 * gets a fresh session row instead of inheriting the previous
 * owner's funnel. Sign-IN does NOT clear — we WANT the anon-to-auth
 * link to work.
 */
export function rotateSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* swallow */
  }
}

// ---------- Queue + flush ----------

export function queueEvent(input: {
  name: string;
  category?: EventCategory;
  properties?: Record<string, unknown>;
}): void {
  if (typeof window === "undefined") return;
  ensureInitialized();

  queue.push({
    name: input.name,
    category: input.category,
    properties: input.properties,
    occurredAt: new Date().toISOString(),
    pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
  });

  if (queue.length >= FLUSH_BATCH_SIZE) {
    void flush();
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush();
    }, FLUSH_INTERVAL_MS);
  }
}

/**
 * Manually flush the queue. Called after sign-in so the server sees
 * the auth state on the next batch and can backfill the session.
 * Resolves once the request completes (or immediately if nothing
 * is queued).
 */
export async function flush(): Promise<void> {
  if (typeof window === "undefined") return;
  if (queue.length === 0) return;

  // Snapshot + clear the queue BEFORE the fetch so events fired
  // during the in-flight request join the next batch instead of
  // double-flushing.
  const batch = queue;
  queue = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const body = {
    sessionId: getSessionId() ?? undefined,
    events: batch,
    meta: metaSent ? undefined : buildSessionMeta(),
  };

  try {
    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Critical for cross-tab isolation in Safari — without this,
      // the cookie-jar fetch can deadlock during page-hide.
      keepalive: batch.length <= 64,
    });
    if (res.ok) {
      const json = (await res.json()) as { sessionId?: string };
      onFlushResponse(json.sessionId);
      metaSent = true;
    } else {
      // Drop on the floor — analytics MUST NOT block UX. We could
      // requeue but that opens us up to runaway memory growth on a
      // backend outage; better to lose a few events.
      console.warn("[analytics] flush failed:", res.status);
    }
  } catch (err) {
    console.warn("[analytics] flush error:", err);
  }
}

function onFlushResponse(serverSessionId: string | undefined): void {
  if (!serverSessionId) return;
  const cached = getSessionId();
  if (cached !== serverSessionId) {
    setSessionId(serverSessionId);
  }
}

// ---------- One-time setup ----------

function ensureInitialized(): void {
  if (initialized) return;
  initialized = true;

  // Flush on page-hide via sendBeacon — fetch with keepalive works
  // most places but Safari is fussy about the unload window. Beacon
  // is fire-and-forget and survives navigation away.
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        beaconFlush();
      }
    });
    window.addEventListener("pagehide", beaconFlush);
  }
}

function beaconFlush(): void {
  if (queue.length === 0) return;
  if (typeof navigator === "undefined" || !navigator.sendBeacon) return;

  const batch = queue;
  queue = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const body = JSON.stringify({
    sessionId: getSessionId() ?? undefined,
    events: batch,
    meta: metaSent ? undefined : buildSessionMeta(),
  });

  // Beacon doesn't let us set a Content-Type. /api/events accepts
  // application/json bodies via Blob with type set — the route reads
  // request.json() which doesn't care about Content-Type as long as
  // the body parses.
  const blob = new Blob([body], { type: "application/json" });
  navigator.sendBeacon("/api/events", blob);
  metaSent = true;
}

function buildSessionMeta() {
  if (typeof window === "undefined") return undefined;
  const url = new URL(window.location.href);
  const utm = {
    source: url.searchParams.get("utm_source") ?? undefined,
    medium: url.searchParams.get("utm_medium") ?? undefined,
    campaign: url.searchParams.get("utm_campaign") ?? undefined,
    term: url.searchParams.get("utm_term") ?? undefined,
    content: url.searchParams.get("utm_content") ?? undefined,
  };
  // Skip the utm block entirely if every field is empty — keeps
  // payloads tighter for organic traffic.
  const hasUtm = Object.values(utm).some(Boolean);

  return {
    landingPath: url.pathname,
    referrer: typeof document !== "undefined" ? document.referrer : undefined,
    utm: hasUtm ? utm : undefined,
    ua: parseUserAgent(),
  };
}

function parseUserAgent(): { browser?: string; os?: string; device?: string } {
  if (typeof navigator === "undefined") return {};
  const ua = navigator.userAgent;
  // Tiny inline parser — we only care about coarse buckets, not full
  // version strings. Avoids pulling in a 30kB user-agent library
  // for a feature that already has GA4 covering the heavy lifting.
  let browser: string | undefined;
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";

  let os: string | undefined;
  if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Linux/.test(ua)) os = "Linux";

  const device =
    /Mobile|Android|iPhone|iPod/.test(ua)
      ? "mobile"
      : /iPad|Tablet/.test(ua)
        ? "tablet"
        : "desktop";

  return { browser, os, device };
}
