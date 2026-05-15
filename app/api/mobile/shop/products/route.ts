import { NextResponse } from "next/server";
import { listShopProducts } from "@/lib/product";

/**
 * GET /api/mobile/shop/products
 *
 * Public product catalog for the mobile shop. Mirrors the web
 * /shop server-fetch — same fields, paise integers, optional
 * category metadata.
 */
export async function GET() {
  const products = await listShopProducts();
  return NextResponse.json({ products });
}
