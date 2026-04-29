import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";

/**
 * Admin push-device registration.
 *
 * The mobile app calls these from the AdminAuthProvider lifecycle:
 *   - admin sign-in (after token issued + me() resolves)
 *   - FCM token rotation (`onTokenRefresh`)
 *   - admin sign-out (DELETE — so a logged-out admin device stops
 *     receiving floor-staff alerts)
 *
 * The same FCM token can also live in PushDevice (customer side) on
 * the same device — that's intentional. A staffer who's signed in
 * as both customer (for their personal bookings) and admin (for
 * floor work) gets pushes from both fan-outs. Logging out of one
 * side removes that token only from that side's table.
 *
 * Tokens are globally unique. Re-binding (admin A signed out, admin
 * B signed in on the same device without DELETE firing) is handled
 * by the upsert here re-pointing the row to the new admin.
 */

const RegisterSchema = z.object({
  token: z.string().min(20).max(4096),
  platform: z.enum(["ios", "android"]),
  appVersion: z.string().max(50).optional(),
});

export async function POST(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { token, platform, appVersion } = parsed.data;

  await db.adminPushDevice.upsert({
    where: { token },
    create: {
      token,
      adminId: admin.id,
      platform,
      appVersion: appVersion ?? null,
    },
    update: {
      adminId: admin.id,
      platform,
      appVersion: appVersion ?? null,
      lastSeenAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = z.object({ token: z.string().min(20) }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  // Scoped to the current admin so a stolen token can't unregister
  // another admin's device.
  await db.adminPushDevice.deleteMany({
    where: { token: parsed.data.token, adminId: admin.id },
  });

  return NextResponse.json({ ok: true });
}
