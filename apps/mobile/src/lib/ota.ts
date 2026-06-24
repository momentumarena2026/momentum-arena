import * as Updates from "expo-updates";

/**
 * Assigns a sticky per-install rollout bucket (0–99) the first time it runs,
 * sent to the self-hosted updates server as `Expo-Extra-Params: rollout-bucket`
 * so it can do deterministic staged % rollouts. expo-updates persists the
 * extra param itself, so we only set it once (when it's not already present).
 * No-op in dev (expo-updates disabled), guarded by try/catch.
 */
export async function ensureOtaRolloutBucket(): Promise<void> {
  try {
    if (!Updates.isEnabled) return;
    const params = await Updates.getExtraParamsAsync();
    if (params["rollout-bucket"] == null) {
      const bucket = String(Math.floor(Math.random() * 100));
      await Updates.setExtraParamAsync("rollout-bucket", bucket);
    }
  } catch {
    // expo-updates not available (e.g. dev) — ignore.
  }
}
