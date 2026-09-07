import { request } from "./admin-api";

/**
 * Register → Orders, on the phone.
 *
 * The cafe's daily sales are written by hand in a book on the counter.
 * This photographs a page, reads it, and hands back rows to check before
 * anything is created — the phone being the obvious place for it, since
 * the book and the camera are already in the same room.
 */

export type RegisterMatchSource = "alias" | "exact" | "fuzzy" | "none";

export type RegisterRow = {
  /** The item column as written — "W.B (F)", not an interpretation. */
  rawItem: string;
  cafeItemId: string | null;
  itemName: string | null;
  matchSource: RegisterMatchSource;
  qty: number;
  writtenPrice: number | null;
  time: string | null;
  payment: "CASH" | "UPI_QR" | null;
  /** Set when the written figure disagrees with the menu's own price. */
  priceWarning: { expected: number; written: number } | null;
};

export type RegisterMenuItem = { id: string; name: string; price: number };
export type RegisterAlias = {
  id: string;
  term: string;
  itemName: string;
  seenCount: number;
};

export async function fetchRegisterSetup(): Promise<{
  menu: RegisterMenuItem[];
  aliases: RegisterAlias[];
}> {
  return request("/api/mobile/admin/cafe-register", { method: "GET" });
}

export async function extractRegister(imageDataUrl: string): Promise<{
  uploadId: string | null;
  rows: RegisterRow[];
  autoMatched: number;
  error: string | null;
  latencyMs: number;
}> {
  return request("/api/mobile/admin/cafe-register", {
    method: "POST",
    body: { imageDataUrl },
  });
}

export async function confirmRegister(input: {
  uploadId: string | null;
  rows: {
    rawItem: string;
    cafeItemId: string;
    qty: number;
    payment: "CASH" | "UPI_QR";
    corrected: boolean;
  }[];
}): Promise<{
  success: boolean;
  created: number;
  failed: number;
  learned: number;
  error?: string;
}> {
  return request("/api/mobile/admin/cafe-register/confirm", {
    method: "POST",
    body: input,
  });
}
