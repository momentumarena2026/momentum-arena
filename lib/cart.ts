import { db } from "@/lib/db";

/**
 * Per-user cart helpers. The Cart row is created lazily — first
 * write creates it via `upsert`. Signed-out users hold the cart in
 * localStorage on the client and POST the contents on sign-in via
 * `mergeIntoServerCart`.
 *
 * Prices are NOT stored on CartItem — the cart is a basket, not a
 * price contract. Server re-prices on checkout against the live
 * Product row (which is also why we don't bother snapshotting on
 * add).
 */

export interface CartLine {
  productId: string;
  name: string;
  pricePaise: number;
  quantity: number;
  stockQuantity: number;
  imageUrl: string | null;
  /** Set when the live product is gone / inactive — UI surfaces a
   *  "this item is no longer available" hint and excludes from the
   *  total. */
  unavailable: boolean;
}

export interface CartSnapshot {
  lines: CartLine[];
  /** Sum of every available line × qty in PAISE. */
  totalPaise: number;
  /** Item count = sum of quantities (skips unavailable). */
  itemCount: number;
}

async function ensureCart(userId: string): Promise<string> {
  const cart = await db.cart.upsert({
    where: { userId },
    update: {},
    create: { userId },
    select: { id: true },
  });
  return cart.id;
}

export async function getCartForUser(userId: string): Promise<CartSnapshot> {
  const cart = await db.cart.findUnique({
    where: { userId },
    include: { items: { include: { product: true } } },
  });
  if (!cart || cart.items.length === 0) {
    return { lines: [], totalPaise: 0, itemCount: 0 };
  }

  const lines: CartLine[] = cart.items.map((ci) => {
    const unavailable = !ci.product.isActive || ci.product.stockQuantity <= 0;
    return {
      productId: ci.product.id,
      name: ci.product.name,
      pricePaise: ci.product.pricePaise,
      // Clamp to live stock so the UI doesn't show 5 in the cart
      // when only 2 are left. We don't mutate the DB row yet —
      // checkout is when the contract closes.
      quantity: Math.min(ci.quantity, Math.max(0, ci.product.stockQuantity)),
      stockQuantity: ci.product.stockQuantity,
      imageUrl: ci.product.imageUrl,
      unavailable,
    };
  });

  const totalPaise = lines
    .filter((l) => !l.unavailable)
    .reduce((sum, l) => sum + l.pricePaise * l.quantity, 0);
  const itemCount = lines
    .filter((l) => !l.unavailable)
    .reduce((sum, l) => sum + l.quantity, 0);

  return { lines, totalPaise, itemCount };
}

/**
 * Add `quantity` of a product to the user's cart. Returns the new
 * snapshot. Caps the requested quantity to `Product.stockQuantity`
 * so the basket never reflects more than the venue can actually
 * sell.
 */
export async function addToCart(
  userId: string,
  productId: string,
  quantity = 1,
): Promise<CartSnapshot> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a positive integer");
  }
  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product || !product.isActive) {
    throw new Error("Product not available");
  }
  if (product.stockQuantity <= 0) {
    throw new Error("This item is out of stock");
  }

  const cartId = await ensureCart(userId);
  const existing = await db.cartItem.findUnique({
    where: { cartId_productId: { cartId, productId } },
  });

  const newQuantity = Math.min(
    product.stockQuantity,
    (existing?.quantity ?? 0) + quantity,
  );

  await db.cartItem.upsert({
    where: { cartId_productId: { cartId, productId } },
    update: { quantity: newQuantity },
    create: { cartId, productId, quantity: newQuantity },
  });

  return getCartForUser(userId);
}

/** Set the absolute quantity for a line. `0` removes the row. */
export async function setCartQuantity(
  userId: string,
  productId: string,
  quantity: number,
): Promise<CartSnapshot> {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error("Quantity must be a non-negative integer");
  }
  const cart = await db.cart.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!cart) return getCartForUser(userId);

  if (quantity === 0) {
    await db.cartItem.deleteMany({ where: { cartId: cart.id, productId } });
    return getCartForUser(userId);
  }

  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product || !product.isActive) {
    throw new Error("Product not available");
  }
  const clamped = Math.min(product.stockQuantity, quantity);
  if (clamped <= 0) {
    await db.cartItem.deleteMany({ where: { cartId: cart.id, productId } });
    return getCartForUser(userId);
  }

  await db.cartItem.upsert({
    where: { cartId_productId: { cartId: cart.id, productId } },
    update: { quantity: clamped },
    create: { cartId: cart.id, productId, quantity: clamped },
  });

  return getCartForUser(userId);
}

export async function clearCart(userId: string): Promise<CartSnapshot> {
  const cart = await db.cart.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (cart) {
    await db.cartItem.deleteMany({ where: { cartId: cart.id } });
  }
  return getCartForUser(userId);
}

/**
 * Merge a localStorage cart into the server cart on sign-in. Each
 * incoming line is added to the existing line via add semantics so
 * a customer who'd already added an item from another device
 * doesn't lose either copy.
 */
export async function mergeIntoServerCart(
  userId: string,
  lines: Array<{ productId: string; quantity: number }>,
): Promise<CartSnapshot> {
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) continue;
    try {
      await addToCart(userId, line.productId, line.quantity);
    } catch {
      // Skip unavailable items silently — the cart UI will refresh
      // off the returned snapshot and the customer sees what
      // survived.
    }
  }
  return getCartForUser(userId);
}
