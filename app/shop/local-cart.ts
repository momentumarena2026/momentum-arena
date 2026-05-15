/**
 * localStorage shadow cart for anonymous shoppers. Lives client-
 * side only; the server-side cart in lib/cart.ts takes over once
 * the user signs in (via `mergeLocalCart`).
 *
 * Schema: an array of `{ productId, quantity }` entries. Older
 * shapes from a future migration would be ignored on read by the
 * parse guard.
 */

const KEY = "shopCart";

export interface LocalCartLine {
  productId: string;
  quantity: number;
}

export function loadLocalCart(): LocalCartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (l): l is LocalCartLine =>
          typeof l?.productId === "string" &&
          Number.isInteger(l?.quantity) &&
          l.quantity > 0,
      )
      .map((l) => ({ productId: l.productId, quantity: l.quantity }));
  } catch {
    return [];
  }
}

export function saveLocalCart(lines: LocalCartLine[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    // Quota / private-mode failures are non-fatal; the user just
    // loses the cart on next visit.
  }
}

export function removeLocalCart(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
