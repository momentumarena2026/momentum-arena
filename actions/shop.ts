"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  addToCart,
  clearCart,
  getCartForUser,
  mergeIntoServerCart,
  setCartQuantity,
  type CartSnapshot,
} from "@/lib/cart";

/**
 * Customer-facing cart server actions. Mirror the equivalent
 * mobile API routes so both surfaces share the same lib helpers.
 *
 * All actions require a signed-in user. Anonymous browsing of the
 * shop is fine; the cart is server-persisted only when the user has
 * an account (anonymous users hold the cart in localStorage and
 * merge on sign-in).
 */

interface CartResult {
  success: boolean;
  error?: string;
  cart?: CartSnapshot;
}

async function requireUser(): Promise<{ userId: string } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Please sign in to use the cart." };
  }
  return { userId: session.user.id };
}

export async function addProductToCart(
  productId: string,
  quantity = 1,
): Promise<CartResult> {
  const u = await requireUser();
  if ("error" in u) return { success: false, error: u.error };
  try {
    const cart = await addToCart(u.userId, productId, quantity);
    revalidatePath("/shop");
    revalidatePath("/shop/cart");
    return { success: true, cart };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Could not add to cart",
    };
  }
}

export async function setCartItemQuantity(
  productId: string,
  quantity: number,
): Promise<CartResult> {
  const u = await requireUser();
  if ("error" in u) return { success: false, error: u.error };
  try {
    const cart = await setCartQuantity(u.userId, productId, quantity);
    revalidatePath("/shop/cart");
    return { success: true, cart };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Could not update cart",
    };
  }
}

export async function emptyCart(): Promise<CartResult> {
  const u = await requireUser();
  if ("error" in u) return { success: false, error: u.error };
  const cart = await clearCart(u.userId);
  revalidatePath("/shop/cart");
  return { success: true, cart };
}

/** Read-only cart snapshot — used by the cart icon badge + drawer. */
export async function getMyCart(): Promise<CartResult> {
  const u = await requireUser();
  if ("error" in u) return { success: false, error: u.error };
  const cart = await getCartForUser(u.userId);
  return { success: true, cart };
}

/**
 * Merge a localStorage cart into the server cart. Called on
 * sign-in by the customer-side bootstrap component, passing the
 * raw lines stored under `shopCart` in localStorage.
 */
export async function mergeLocalCart(
  lines: Array<{ productId: string; quantity: number }>,
): Promise<CartResult> {
  const u = await requireUser();
  if ("error" in u) return { success: false, error: u.error };
  const cart = await mergeIntoServerCart(u.userId, lines);
  revalidatePath("/shop/cart");
  return { success: true, cart };
}
