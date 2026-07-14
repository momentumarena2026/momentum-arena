import { Platform } from "react-native";
import * as Application from "expo-application";
import * as Keychain from "react-native-keychain";

/**
 * Stable per-device identifier for the trusted-device gate on the
 * hidden admin entry (see /api/mobile/device-trust).
 *
 * Strategy: on first use, read the platform identifier —
 * ANDROID_ID on Android, identifierForVendor on iOS — and persist it
 * in the Keychain. The Keychain copy is authoritative from then on,
 * which papers over the platform IDs' known instabilities (IDFV
 * changes when all vendor apps are uninstalled; Keychain survives
 * reinstalls on iOS). If the platform ID is unavailable we mint a
 * random UUID-shaped fallback instead.
 *
 * NOT a security boundary — it gates DISCOVERY of the admin login
 * screen only; credentials + server-side permissions remain the
 * actual protection.
 */

const DEVICE_ID_SERVICE = "com.momentumarena.app.deviceid";
const DEVICE_ID_ACCOUNT = "device";

let cached: string | null = null;

function randomFallbackId(): string {
  // Math.random is fine here — worst case two devices collide and one
  // shows up pre-trusted, which the admin list makes visible anyway.
  const hex = () =>
    Math.floor(Math.random() * 0xffff)
      .toString(16)
      .padStart(4, "0");
  return `rnd-${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
}

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;

  // 1. Keychain copy wins — it's the ID this device may already be
  //    registered under.
  try {
    const stored = await Keychain.getGenericPassword({
      service: DEVICE_ID_SERVICE,
    });
    if (stored && stored.password) {
      cached = stored.password;
      return cached;
    }
  } catch {
    /* keychain unavailable — fall through to platform id */
  }

  // 2. Platform identifier.
  let id: string | null = null;
  try {
    id =
      Platform.OS === "android"
        ? Application.getAndroidId()
        : await Application.getIosIdForVendorAsync();
  } catch {
    id = null;
  }
  if (!id) id = randomFallbackId();

  // 3. Persist for stability; failure to persist is non-fatal.
  try {
    await Keychain.setGenericPassword(DEVICE_ID_ACCOUNT, id, {
      service: DEVICE_ID_SERVICE,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
    });
  } catch {
    /* best effort */
  }

  cached = id;
  return id;
}

/** Short human label for auto-registration at admin login. */
export function deviceLabelHint(): string {
  return Platform.OS === "ios" ? "iOS device" : "Android device";
}
