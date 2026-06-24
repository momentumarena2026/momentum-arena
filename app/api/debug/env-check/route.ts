import { NextResponse } from "next/server";

// TEMPORARY diagnostic: reports whether specific env vars are present on the
// running deployment (booleans only — never the values). Gated by a secret
// query key so it isn't publicly enumerable. Remove once the OTP-bypass env
// scope is confirmed.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY = "otadbg-7c3f9a";

export async function GET(req: Request) {
  const k = new URL(req.url).searchParams.get("k");
  if (k !== KEY) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json({
    APPSTORE_TEST_PHONE: !!process.env.APPSTORE_TEST_PHONE,
    APPSTORE_TEST_OTP: !!process.env.APPSTORE_TEST_OTP,
    // Control: a var known to be set correctly on this scope (DQR works here).
    PHONEPE_DQR_MERCHANT_ID: !!process.env.PHONEPE_DQR_MERCHANT_ID,
    EXPO_OTA_PRIVATE_KEY: !!process.env.EXPO_OTA_PRIVATE_KEY,
    BLOB_READ_WRITE_TOKEN: !!process.env.BLOB_READ_WRITE_TOKEN,
  });
}
