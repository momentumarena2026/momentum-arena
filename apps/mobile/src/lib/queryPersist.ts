import { MMKV } from "react-native-mmkv";
import type { QueryClient } from "@tanstack/react-query";

/**
 * Disk-backed react-query cache.
 *
 * Force-closing the app throws away every in-memory query, so the next
 * launch had nothing to draw and sat on skeletons until five separate
 * requests came back from Virginia. Persisting the cache means the
 * landing screen paints last-known content on the first frame and the
 * network refresh lands underneath it — the difference between "the app
 * is slow" and "the app is instant and then updates".
 *
 * Hand-rolled on the MMKV store the app already ships rather than adding
 * @tanstack/react-query-persist-client: no new dependency means no
 * fingerprint change, so this reaches phones over OTA.
 */

const store = new MMKV({ id: "query-cache" });
const KEY = "v1";

/** How stale a persisted entry may be before we ignore it on boot. Past
 *  this, showing it would be worse than showing nothing — prices and
 *  seat counts go off. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Queries worth restoring: public catalogue data and the signed-in
 * user's own dashboard. Deliberately a whitelist — anything involving a
 * live payment, a QR, or an availability grid must always be fetched
 * fresh, and a stale slot grid would let someone tap a taken slot.
 */
const PERSIST: readonly string[] = [
  "dashboard",
  "tournaments",
  "camps-hub",
  "promo-banners",
  "sport-promo",
  "info-bar",
  "my-passes",
  "notifications",
];

interface Entry {
  key: unknown[];
  data: unknown;
  at: number;
}

function shouldPersist(key: readonly unknown[]): boolean {
  return typeof key[0] === "string" && PERSIST.includes(key[0]);
}

/** Load the last session's data into the cache. Call BEFORE first render
 *  so the first paint already has it. */
export function hydrateQueryCache(client: QueryClient): void {
  try {
    const raw = store.getString(KEY);
    if (!raw) return;
    const entries = JSON.parse(raw) as Entry[];
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const e of entries) {
      if (!Array.isArray(e.key) || e.at < cutoff) continue;
      // dataUpdatedAt carries the ORIGINAL fetch time, so react-query
      // still treats it as stale and refetches — we're seeding the first
      // paint, not suppressing the refresh.
      client.setQueryData(e.key, e.data, { updatedAt: e.at });
    }
  } catch {
    // A corrupt blob must never stop the app booting.
    store.delete(KEY);
  }
}

/** Mirror future cache writes to disk. Returns an unsubscribe. */
export function persistQueryCache(client: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const write = () => {
    timer = null;
    try {
      const entries: Entry[] = [];
      for (const q of client.getQueryCache().getAll()) {
        if (q.state.status !== "success" || q.state.data === undefined) continue;
        if (!shouldPersist(q.queryKey)) continue;
        entries.push({
          key: q.queryKey as unknown[],
          data: q.state.data,
          at: q.state.dataUpdatedAt,
        });
      }
      store.set(KEY, JSON.stringify(entries));
    } catch {
      // Out of disk, or something unserialisable slipped into a cache
      // entry. Losing the warm start is survivable; crashing isn't.
    }
  };

  return client.getQueryCache().subscribe(() => {
    // Coalesce: a screen settling fires many cache events at once, and
    // serialising on each one would be the very jank we're removing.
    if (timer) return;
    timer = setTimeout(write, 1000);
  });
}

/** Drop everything — called on sign-out so the next account never sees
 *  the previous one's dashboard. */
export function clearPersistedQueries(): void {
  store.delete(KEY);
}
