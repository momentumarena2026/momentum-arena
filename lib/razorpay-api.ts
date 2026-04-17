// Razorpay REST API wrapper for dashboard data fetching

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const RAZORPAY_API_BASE = "https://api.razorpay.com/v1";

// --- Types ---

export interface RzpPayment {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  status: string;
  method: string;
  description: string | null;
  order_id: string | null;
  email: string;
  contact: string;
  created_at: number;
  captured: boolean;
  error_code: string | null;
  error_description: string | null;
}

export interface RzpOrder {
  id: string;
  entity: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string | null;
  status: string;
  created_at: number;
}

export interface RzpRefund {
  id: string;
  entity: string;
  payment_id: string;
  amount: number;
  currency: string;
  status: string;
  created_at: number;
}

export interface RzpSettlement {
  id: string;
  entity: string;
  amount: number;
  status: string;
  fees: number;
  tax: number;
  utr: string;
  created_at: number;
}

export interface RzpDispute {
  id: string;
  entity: string;
  payment_id: string;
  amount: number;
  currency: string;
  reason_code: string;
  status: string;
  created_at: number;
}

interface RzpCollection<T> {
  entity: "collection";
  count: number;
  items: T[];
}

// --- Generic fetch helper ---

async function razorpayFetch<T>(
  path: string,
  params?: Record<string, string | number | undefined>
): Promise<T> {
  const auth = Buffer.from(
    `${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`
  ).toString("base64");

  const url = new URL(`${RAZORPAY_API_BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Basic ${auth}`,
    },
    next: { revalidate: 60 }, // Cache for 60 seconds
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Razorpay API error (${response.status}): ${errorText}`
    );
  }

  return response.json();
}

// --- Date helper ---

function toUnixTimestamp(date: string | Date | undefined): number | undefined {
  if (!date) return undefined;
  const d = typeof date === "string" ? new Date(date) : date;
  return Math.floor(d.getTime() / 1000);
}

// --- Exported API functions ---

export interface FetchListParams {
  count?: number;
  skip?: number;
  from?: string | Date;
  to?: string | Date;
}

export async function fetchPayments(
  params: FetchListParams & { status?: string } = {}
): Promise<{ items: RzpPayment[]; count: number }> {
  const result = await razorpayFetch<RzpCollection<RzpPayment>>("/payments", {
    count: params.count || 20,
    skip: params.skip || 0,
    from: toUnixTimestamp(params.from),
    to: toUnixTimestamp(params.to),
  });
  return { items: result.items, count: result.count };
}

export async function fetchPayment(id: string): Promise<RzpPayment> {
  return razorpayFetch<RzpPayment>(`/payments/${id}`);
}

export async function fetchOrders(
  params: FetchListParams = {}
): Promise<{ items: RzpOrder[]; count: number }> {
  const result = await razorpayFetch<RzpCollection<RzpOrder>>("/orders", {
    count: params.count || 20,
    skip: params.skip || 0,
    from: toUnixTimestamp(params.from),
    to: toUnixTimestamp(params.to),
  });
  return { items: result.items, count: result.count };
}

export async function fetchOrder(id: string): Promise<RzpOrder> {
  return razorpayFetch<RzpOrder>(`/orders/${id}`);
}

export async function fetchOrderPayments(
  orderId: string
): Promise<{ items: RzpPayment[] }> {
  return razorpayFetch<{ items: RzpPayment[] }>(
    `/orders/${orderId}/payments`
  );
}

export async function fetchRefunds(
  params: FetchListParams = {}
): Promise<{ items: RzpRefund[]; count: number }> {
  const result = await razorpayFetch<RzpCollection<RzpRefund>>("/refunds", {
    count: params.count || 20,
    skip: params.skip || 0,
    from: toUnixTimestamp(params.from),
    to: toUnixTimestamp(params.to),
  });
  return { items: result.items, count: result.count };
}

export async function fetchSettlements(
  params: FetchListParams = {}
): Promise<{ items: RzpSettlement[]; count: number }> {
  const result = await razorpayFetch<RzpCollection<RzpSettlement>>(
    "/settlements",
    {
      count: params.count || 20,
      skip: params.skip || 0,
      from: toUnixTimestamp(params.from),
      to: toUnixTimestamp(params.to),
    }
  );
  return { items: result.items, count: result.count };
}

export async function fetchDisputes(
  params: { count?: number; skip?: number } = {}
): Promise<{ items: RzpDispute[]; count: number }> {
  const result = await razorpayFetch<RzpCollection<RzpDispute>>("/disputes", {
    count: params.count || 20,
    skip: params.skip || 0,
  });
  return { items: result.items, count: result.count };
}
