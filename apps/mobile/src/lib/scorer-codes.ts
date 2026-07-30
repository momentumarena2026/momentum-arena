import { mmkv } from "./storage";

// Remembered scorer codes. A code is a shared credential, not a personal
// secret, and the whole point is that a volunteer can pick their phone up
// mid-tournament and carry on — so the last few codes live in MMKV
// (non-sensitive store) with the tournament name for recognition.

const KEY = "scorer.recentCodes";
const MAX = 5;

export type RecentScorerCode = { code: string; name: string; at: number };

export function recentScorerCodes(): RecentScorerCode[] {
  try {
    const raw = mmkv.getString(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentScorerCode[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberScorerCode(code: string, name: string): void {
  try {
    const next = [
      { code, name, at: Date.now() },
      ...recentScorerCodes().filter((r) => r.code !== code),
    ].slice(0, MAX);
    mmkv.set(KEY, JSON.stringify(next));
  } catch {
    /* remembering is a convenience — never break scoring over it */
  }
}

export function forgetScorerCode(code: string): void {
  try {
    mmkv.set(KEY, JSON.stringify(recentScorerCodes().filter((r) => r.code !== code)));
  } catch {
    /* ignore */
  }
}
