import * as Keychain from "react-native-keychain";
import { MMKV } from "react-native-mmkv";

/**
 * MMKV — fast, synchronous, persistent key/value store for non-sensitive state
 * (cached user profile, onboarding flags, etc.). Put JSON or plain strings.
 */
export const mmkv = new MMKV({ id: "momentum-arena-cache" });

/**
 * Keychain — encrypted storage for the mobile JWT. One "service" acts as the
 * namespace so we can hold a single token at a time.
 */
const TOKEN_SERVICE = "com.momentumarena.app.token";
const TOKEN_ACCOUNT = "access";

export const tokenStorage = {
  async save(token: string): Promise<void> {
    await Keychain.setGenericPassword(TOKEN_ACCOUNT, token, {
      service: TOKEN_SERVICE,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
    });
  },

  async read(): Promise<string | null> {
    const creds = await Keychain.getGenericPassword({ service: TOKEN_SERVICE });
    if (!creds) return null;
    return creds.password;
  },

  async clear(): Promise<void> {
    await Keychain.resetGenericPassword({ service: TOKEN_SERVICE });
  },
};

/**
 * Cached user profile (non-sensitive mirror of /api/mobile/me). Lets the app
 * render the authed UI instantly on cold start while the network hydrates.
 */
const USER_KEY = "auth.user";

export type CachedUser = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  image: string | null;
};

export const userCache = {
  read(): CachedUser | null {
    const raw = mmkv.getString(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedUser;
    } catch {
      return null;
    }
  },
  write(user: CachedUser): void {
    mmkv.set(USER_KEY, JSON.stringify(user));
  },
  clear(): void {
    mmkv.delete(USER_KEY);
  },
};
