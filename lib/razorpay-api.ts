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

// --- Settlement recon (combined) -------------------------------------------
// Razorpay's "combined" recon endpoint returns the per-line settlement
// breakdown — every payment / refund / adjustment / transfer that contributed
// to settlements in the window, with fees, tax, debit/credit, settlement_id,
// UTR, processed_at, etc. This is what the dashboard's "Settlement
// Reconciliation" XLSX export uses.
//
// Endpoint: GET /v1/settlements/recon/combined?year=YYYY&month=M&count=N&skip=N
// (year/month are Razorpay's preferred form for monthly recon — they
// internally translate to the right from/to range).
//
// We page through with count=100 (RZP cap) until the response is short. The
// queue worker calls this once per report build.

export interface RzpReconRow {
  entity_id: string;
  type: string;
  debit: number;
  credit: number;
  amount: number;
  currency: string;
  fee: number;
  tax: number;
  on_hold: 0 | 1;
  settled: 0 | 1;
  created_at: number;
  settled_at: number | null;
  settlement_id: string | null;
  posted_at: number | null;
  credit_type: string | null;
  payment_id: string | null;
  description: string | null;
  notes: Record<string, string> | null;
  order_id: string | null;
  order_receipt: string | null;
  method: string | null;
  card_network: string | null;
  card_issuer: string | null;
  card_type: string | null;
  dispute_id: string | null;
  bank: string | null;
  email: string | null;
  contact: string | null;
  transfer_id: string | null;
  international: boolean | null;
}

const RECON_PAGE_SIZE = 100;
const RECON_HARD_PAGE_LIMIT = 50; // 5000 rows/month — way beyond our scale.

export async function fetchSettlementReconForMonth(
  year: number,
  month1to12: number,
): Promise<RzpReconRow[]> {
  const all: RzpReconRow[] = [];
  for (let page = 0; page < RECON_HARD_PAGE_LIMIT; page++) {
    const batch = await razorpayFetch<RzpCollection<RzpReconRow>>(
      "/settlements/recon/combined",
      {
        year,
        month: month1to12,
        count: RECON_PAGE_SIZE,
        skip: page * RECON_PAGE_SIZE,
      },
    );
    all.push(...batch.items);
    if (batch.items.length < RECON_PAGE_SIZE) break;
  }
  return all;
}
