import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { adminAuthApi, type AdminUser } from "../lib/admin-auth";
import {
  disableAdminPushBeforeLogout,
  enableAdminPushAfterLogin,
} from "../lib/push";

/**
 * Admin session state, separate from the customer AuthProvider so
 * the two can coexist on the same device. The admin session lives
 * in its own Keychain slot (see `adminTokenStorage`) and survives
 * customer sign-out / sign-in.
 *
 * "loading" only applies to the cold-start hydration check. After
 * that, the state is either signedOut (no admin token) or signedIn
 * (token validated against /api/mobile/admin/me).
 */
type AdminAuthState =
  | { status: "loading"; admin: null }
  | { status: "signedOut"; admin: null }
  | { status: "signedIn"; admin: AdminUser };

interface AdminAuthContextValue {
  state: AdminAuthState;
  signIn: (admin: AdminUser) => void;
  signOut: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AdminAuthState>({
    status: "loading",
    admin: null,
  });

  useEffect(() => {
    // Cold-start hydration. Network failures (no internet on app
    // launch) leave the user signed-out rather than stuck loading;
    // they can re-attempt login when connectivity returns.
    void (async () => {
      try {
        const admin = await adminAuthApi.me();
        if (admin) {
          setState({ status: "signedIn", admin });
          // Persisted Keychain session implies a still-valid bearer
          // — re-register the FCM token under AdminPushDevice so a
          // fresh app launch resumes receiving floor-staff alerts.
          // Fire-and-forget; failures (no permission, FCM down) are
          // logged inside the helper and shouldn't block hydration.
          void enableAdminPushAfterLogin();
        } else {
          setState({ status: "signedOut", admin: null });
        }
      } catch {
        setState({ status: "signedOut", admin: null });
      }
    })();
  }, []);

  const signIn = useCallback((admin: AdminUser) => {
    setState({ status: "signedIn", admin });
    // Match the customer flow: hand the FCM token to the admin-side
    // registry as soon as the bearer is in Keychain. Lets the device
    // start receiving admin pushes within seconds of login.
    void enableAdminPushAfterLogin();
  }, []);

  const signOut = useCallback(async () => {
    // Drop the device from AdminPushDevice BEFORE clearing the
    // bearer — once the token is gone the DELETE call would 401.
    await disableAdminPushBeforeLogout();
    await adminAuthApi.signOut();
    setState({ status: "signedOut", admin: null });
  }, []);

  const value = useMemo<AdminAuthContextValue>(
    () => ({ state, signIn, signOut }),
    [state, signIn, signOut],
  );

  return (
    <AdminAuthContext.Provider value={value}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error("useAdminAuth must be used inside <AdminAuthProvider>");
  }
  return ctx;
}
