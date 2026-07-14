import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Is this device allowed to reveal the hidden admin entry (the 5-tap
 * on the app's version footer)?
 *
 * Public by design — the check runs BEFORE any admin login exists on
 * the device, and the response leaks nothing beyond a boolean for an
 * ID only that device knows. Real security stays where it always was:
 * admin credentials + per-route permission checks. This endpoint only
 * gates DISCOVERY of the login screen.
 *
 * GRACE RULE: while the TrustedDevice table is empty the answer is
 * always "trusted", so shipping this feature can never lock the team
 * out before the first device is registered.
 *
 * GET /api/mobile/device-trust?deviceId=...  →  { trusted: boolean }
 */
export async function GET(request: NextRequest) {
  const deviceId = request.nextUrl.searchParams.get("deviceId")?.trim();
  if (!deviceId || deviceId.length > 128) {
    return NextResponse.json({ trusted: false });
  }

  try {
    const registered = await db.trustedDevice.count();
    if (registered === 0) {
      return NextResponse.json({ trusted: true });
    }

    const device = await db.trustedDevice.findUnique({
      where: { deviceId },
      select: { id: true },
    });
    if (!device) {
      return NextResponse.json({ trusted: false });
    }

    // Fire-and-forget freshness stamp for the admin page's
    // "last seen" column.
    db.trustedDevice
      .update({ where: { id: device.id }, data: { lastSeenAt: new Date() } })
      .catch(() => {});

    return NextResponse.json({ trusted: true });
  } catch {
    // DB hiccup → fail closed; the client treats errors as untrusted
    // anyway, and an already-signed-in admin bypasses the check.
    return NextResponse.json({ trusted: false });
  }
}
