import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { authApi } from "../lib/auth";
import { setUnauthorizedHandler } from "../lib/api";
import { tokenStorage, userCache, type CachedUser } from "../lib/storage";
import {
  flushAnalytics,
  rotateAnalyticsSession,
  trackLoginSuccess,
  trackSignOutClick,
} from "../lib/analytics";
import { enablePushAfterLogin, disablePushBeforeLogout } from "../lib/push";

type AuthState =
  | { status: "loading"; user: null }
  | { status: "signedOut"; user: null }
  | { status: "signedIn"; user: CachedUser };

interface AuthContextValue {
  state: AuthState;
  signIn: (user: CachedUser) => void;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });

  const bootstrap = useCallback(async () => {
    const token = await tokenStorage.read();
    if (!token) {
      setState({ status: "signedOut", user: null });
      return;
    }

    // Optimistic UI from cache, then validate against server.
    const cached = userCache.read();
    if (cached) setState({ status: "signedIn", user: cached });

    try {
      const fresh = await authApi.me();
      setState({ status: "signedIn", user: fresh });
      // Cold start with an existing valid session — make sure the
      // current FCM token is registered. Idempotent on backend
      // (upsert by token).
      void enablePushAfterLogin();
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) {
        // Token rejected — clear and push to auth.
        await authApi.signOut();
        setState({ status: "signedOut", user: null });
      } else {
        // Network hiccup: keep cached session, let the user retry actions.
        if (!cached) setState({ status: "signedOut", user: null });
      }
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const signIn = useCallback((user: CachedUser) => {
    setState({ status: "signedIn", user });
    // Best-effort: register the FCM token with the backend so pushes
    // start landing on this device. Promise is intentionally not
    // awaited — the OS permission prompt shouldn't block the UI
    // transition into the signed-in app.
    void enablePushAfterLogin();
    // Stamp the login + flush so the next analytics batch lands
    // attributed to the new user. The server backfills the session
    // and prior anon events on the same flush.
    trackLoginSuccess();
    void flushAnalytics();
  }, []);

  const signOut = useCallback(async () => {
    // Stamp + flush BEFORE we drop the JWT so the sign-out event is
    // attributed to the OUTGOING user. Then rotate the analytics
    // session so the next user on the same device starts fresh.
    trackSignOutClick();
    await flushAnalytics();
    rotateAnalyticsSession();
    // Unregister the device FIRST so a stolen-or-borrowed phone
    // doesn't keep getting pushes for the previous owner. If this
    // fails (network), proceed anyway — the server falls back to
    // dead-token cleanup on the next failed FCM send.
    await disablePushBeforeLogout();
    await authApi.signOut();
    setState({ status: "signedOut", user: null });
  }, []);

  // Any authenticated request that comes back 401 should drop us to
  // signed-out, so the user gets routed back through Phone / Otp instead of
  // repeatedly hitting unhelpful error cards. Registered once on mount and
  // torn down on unmount.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void signOut();
    });
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, signIn, signOut, refresh: bootstrap }),
    [state, signIn, signOut, bootstrap]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
