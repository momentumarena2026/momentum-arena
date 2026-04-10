import crypto from "crypto";

const PHONEPE_MERCHANT_ID = process.env.PHONEPE_MERCHANT_ID;
const PHONEPE_SALT_KEY = process.env.PHONEPE_SALT_KEY;
const PHONEPE_SALT_INDEX = process.env.PHONEPE_SALT_INDEX || "1";
const PHONEPE_ENV = process.env.PHONEPE_ENV || "SANDBOX"; // "SANDBOX" | "PRODUCTION"

const BASE_URL =
  PHONEPE_ENV === "PRODUCTION"
    ? "https://api.phonepe.com/apis/hermes"
    : "https://api-preprod.phonepe.com/apis/pg-sandbox";

if (!PHONEPE_MERCHANT_ID || !PHONEPE_SALT_KEY) {
  console.warn(
    "WARNING: PHONEPE_MERCHANT_ID or PHONEPE_SALT_KEY not set. PhonePe payments will fail."
  );
}

export { PHONEPE_MERCHANT_ID };

// Generate X-VERIFY header
function generateChecksum(payload: string, endpoint: string): string {
  const data = payload + endpoint + PHONEPE_SALT_KEY;
  const hash = crypto.createHash("sha256").update(data).digest("hex");
  return hash + "###" + PHONEPE_SALT_INDEX;
}

interface PhonePePayResponse {
  success: boolean;
  code: string;
  message: string;
  data: {
    merchantId: string;
    merchantTransactionId: string;
    instrumentResponse: {
      type: string;
      redirectInfo: {
        url: string;
        method: string;
      };
    };
  };
}

// Initiate a PhonePe payment
export async function initiatePhonePePayment({
  merchantTransactionId,
  amount,
  callbackUrl,
  redirectUrl,
  userPhone,
}: {
  merchantTransactionId: string;
  amount: number; // in paise
  callbackUrl: string;
  redirectUrl: string;
  userPhone?: string;
}): Promise<{ redirectUrl: string; merchantTransactionId: string }> {
  const payload = {
    merchantId: PHONEPE_MERCHANT_ID,
    merchantTransactionId,
    merchantUserId: "MUID_" + merchantTransactionId.slice(0, 20),
    amount,
    redirectUrl,
    redirectMode: "REDIRECT",
    callbackUrl,
    paymentInstrument: {
      type: "PAY_PAGE",
    },
    ...(userPhone ? { mobileNumber: userPhone } : {}),
  };

  const base64Payload = Buffer.from(JSON.stringify(payload)).toString("base64");
  const checksum = generateChecksum(base64Payload, "/pg/v1/pay");

  const response = await fetch(`${BASE_URL}/pg/v1/pay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-VERIFY": checksum,
    },
    body: JSON.stringify({ request: base64Payload }),
  });

  const result = (await response.json()) as PhonePePayResponse;

  if (!result.success) {
    throw new Error(
      `PhonePe payment initiation failed: ${result.code} — ${result.message}`
    );
  }

  return {
    redirectUrl: result.data.instrumentResponse.redirectInfo.url,
    merchantTransactionId: result.data.merchantTransactionId,
  };
}

interface PhonePeStatusResponse {
  success: boolean;
  code: string;
  message: string;
  data: {
    merchantId: string;
    merchantTransactionId: string;
    transactionId: string;
    amount: number;
    state: string; // COMPLETED, PENDING, FAILED
    responseCode: string;
    paymentInstrument: {
      type: string;
      utr?: string;
    };
  };
}

// Check payment status (server-to-server)
export async function checkPhonePeStatus(
  merchantTransactionId: string
): Promise<{
  success: boolean;
  transactionId: string;
  state: string;
  amount: number;
}> {
  const endpoint = `/pg/v1/status/${PHONEPE_MERCHANT_ID}/${merchantTransactionId}`;
  const data = endpoint + PHONEPE_SALT_KEY;
  const hash = crypto.createHash("sha256").update(data).digest("hex");
  const checksum = hash + "###" + PHONEPE_SALT_INDEX;

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-VERIFY": checksum,
      "X-MERCHANT-ID": PHONEPE_MERCHANT_ID || "",
    },
  });

  const result = (await response.json()) as PhonePeStatusResponse;

  return {
    success: result.success && result.data?.state === "COMPLETED",
    transactionId: result.data?.transactionId || "",
    state: result.data?.state || "FAILED",
    amount: result.data?.amount || 0,
  };
}

// Verify callback checksum (PG online payments — V2: SHA256(response + saltKey))
export function verifyPhonePeCallback(
  xVerifyHeader: string,
  responseBody: string
): boolean {
  const data = responseBody + PHONEPE_SALT_KEY;
  const hash = crypto.createHash("sha256").update(data).digest("hex");
  const expected = hash + "###" + PHONEPE_SALT_INDEX;
  return xVerifyHeader === expected;
}

// Verify Static QR callback checksum
// V1: SHA256(merchantId + transactionId + amount + saltKey)
export function verifyStaticQrCallback(
  xVerifyHeader: string,
  merchantId: string,
  transactionId: string,
  amount: number
): boolean {
  const data = merchantId + transactionId + amount + PHONEPE_SALT_KEY;
  const hash = crypto.createHash("sha256").update(data).digest("hex");
  const expected = hash + "###" + PHONEPE_SALT_INDEX;
  return xVerifyHeader === expected;
}

// Decoded Static QR callback payload
export interface StaticQrCallbackData {
  success: boolean;
  code: string;
  message: string;
  data: {
    transactionId: string;
    merchantId: string;
    providerReferenceId: string;
    amount: number; // in paise
    paymentState: string; // COMPLETED | FAILED
    payResponseCode?: string;
    paymentModes?: Array<{
      mode: string;
      amount: number;
      utr?: string;
    }>;
    transactionContext?: {
      storeId?: string;
      terminalId?: string;
    };
  };
}
