import { Platform } from "react-native";
import { env } from "../config/env";
import { adminTokenStorage } from "./storage";

/**
 * Shared bearer-auth + JSON-fetch wrapper for the mobile admin
 * surface. Each feature module (bookings, check-in, calendar, slot
 * blocks, cafe, expenses) imports `request` and `AdminApiError` from
 * here so we only have one place that handles token loading, content
 * negotiation, and error mapping.
 */

export class AdminApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function request<T>(
  path: string,
  init: { method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"; body?: unknown },
): Promise<T> {
  const token = await adminTokenStorage.read();
  if (!token) throw new AdminApiError("Not signed in as admin", 401);

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "X-Platform": Platform.OS === "ios" ? "ios" : "android",
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (err) {
    throw new AdminApiError(
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
    throw new AdminApiError(msg, res.status);
  }

  return payload as T;
}
