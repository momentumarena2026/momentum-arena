import { Platform } from "react-native";
import { env } from "../config/env";
import { adminTokenStorage } from "./storage";

/**
 * Admin auth API client. Lives separately from `lib/auth.ts` (the
 * customer one) because the two surfaces use independent JWTs and
 * independent Keychain slots — they shouldn't share request paths or
 * accidentally cross-pollinate tokens.
 */

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: string;
  permissions: string[];
}

interface LoginResponse {
  token: string;
  admin: AdminUser;
}

interface MeResponse {
  admin: AdminUser;
}

export class AdminAuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; token?: string },
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Platform": Platform.OS === "ios" ? "ios" : "android",
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.token) headers.Authorization = `Bearer ${init.token}`;

  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (err) {
    throw new AdminAuthError(
      err instanceof Error ? err.message : "Network error",
      0,
    );
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const msg =
      (payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : null) || `Request failed with ${res.status}`;
    throw new AdminAuthError(msg, res.status);
  }

  return payload as T;
}

export const adminAuthApi = {
  /**
   * Validate username + password against the AdminUser table.
   * Stores the returned bearer token in Keychain on success and
   * returns the admin profile.
   */
  async login(username: string, password: string): Promise<AdminUser> {
    const res = await request<LoginResponse>("/api/mobile/admin/login", {
      method: "POST",
      body: { username, password },
    });
    await adminTokenStorage.save(res.token);
    return res.admin;
  },

  /**
   * Re-fetch the admin profile using the stored token. Returns null
   * if the token is missing or the server rejects it (deleted user,
   * permissions revoked, etc.). The provider treats null as "signed
   * out" and clears the Keychain slot.
   */
  async me(): Promise<AdminUser | null> {
    const token = await adminTokenStorage.read();
    if (!token) return null;
    try {
      const res = await request<MeResponse>("/api/mobile/admin/me", {
        method: "GET",
        token,
      });
      return res.admin;
    } catch (err) {
      if (err instanceof AdminAuthError && err.status === 401) {
        await adminTokenStorage.clear();
        return null;
      }
      throw err;
    }
  },

  async signOut(): Promise<void> {
    await adminTokenStorage.clear();
  },
};
