import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { listMyOrders, placeCustomerOrder } from "@/actions/shop-order";

/**
 * GET  /api/mobile/shop/orders            — list signed-in user's orders
 * POST /api/mobile/shop/orders            — { method: "RAZORPAY" | "UPI_QR" | "CASH" }
 *   Drains the user's cart into a new ProductOrder and returns the order
 *   id. The mobile client decides next step based on `method`:
 *     RAZORPAY: hits /razorpay/create-order → native SDK → /verify
 *     UPI_QR / CASH: navigates straight to the order detail screen
 */
export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orders = await listMyOrders();
  return NextResponse.json({ orders });
}

export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { method?: "RAZORPAY" | "UPI_QR" | "CASH" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!body.method) {
    return NextResponse.json({ error: "method is required" }, { status: 400 });
  }
  const res = await placeCustomerOrder(body.method);
  if (!res.success) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }
  return NextResponse.json({
    orderId: res.orderId,
    orderNumber: res.orderNumber,
  });
}
