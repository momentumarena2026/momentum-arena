/**
 * The web build of device storage — for the admin's challenge preview only.
 *
 * `.web.ts` is React Native's own platform-extension convention: Metro
 * resolves `.ios.ts` / `.native.ts` / `.ts` and never sees this file, so a
 * phone still gets the keychain and MMKV. Only the web bundler picks it up.
 *
 * It exists because `api.ts` reads the session token from here, so anything
 * importing the app's api client — which the challenge screen does, for its
 * types and its fetchers — drags react-native-keychain and react-native-mmkv
 * into a web bundle. Both are native, and MMKV's TurboModule spec is Flow
 * source the web bundler cannot parse at all.
 *
 * EVERY READ IS EMPTY, AND THAT IS THE POINT. A preview has no session: it
 * is an admin looking at what a customer sees, not that customer signed in.
 * The screen never fetches — its query cache is pre-seeded and fetching is
 * switched off — so the token is never needed. An empty store is the honest
 * answer rather than a faked one, and a write that goes nowhere is correct
 * for a page that must not mutate the admin's browser either.
 *
 * If a preview ever appears to be signed in, or a screen starts depending
 * on cached user state to render, this file is where it will show as blank.
 */

export const mmkv = {
  getString: (): string | undefined => undefined,
  set: (): void => undefined,
  delete: (): void => undefined,
  contains: (): boolean => false,
  clearAll: (): void => undefined,
};

const emptyToken = {
  async save(): Promise<void> {},
  async read(): Promise<string | null> {
    return null;
  },
  async clear(): Promise<void> {},
};

export const tokenStorage = emptyToken;
export const adminTokenStorage = emptyToken;

export type CachedUser = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
};

export const userCache = {
  read: (): CachedUser | null => null,
  write: (): void => undefined,
  clear: (): void => undefined,
};
