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
        if (admin) setState({ status: "signedIn", admin });
        else setState({ status: "signedOut", admin: null });
      } catch {
        setState({ status: "signedOut", admin: null });
      }
    })();
  }, []);

  const signIn = useCallback((admin: AdminUser) => {
    setState({ status: "signedIn", admin });
  }, []);

  const signOut = useCallback(async () => {
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
