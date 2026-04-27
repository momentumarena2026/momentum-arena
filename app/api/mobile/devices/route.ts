import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getMobileUser } from "@/lib/mobile-auth";

/**
 * Mobile push-device registration.
 *
 * The mobile app calls these on:
 *   - sign-in (after token issued)
 *   - FCM token rotation (`onTokenRefresh`)
 *   - sign-out (DELETE — so a logged-out device stops receiving pushes
 *     for the previously-signed-in user)
 *
 * Tokens are globally unique to an FCM install. If the same token
 * appears under a different userId (rare: user A signed out and user
 * B signed in on the same device without DELETE firing), the upsert
 * here re-points the row to the new owner.
 */

const RegisterSchema = z.object({
  token: z.string().min(20).max(4096),
  platform: z.enum(["ios", "android"]),
  appVersion: z.string().max(50).optional(),
});

export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
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

  // Upsert by token (the unique key). If the row already exists under
  // a different user, claim it for the current user — this is the
  // "user switch on a shared device without explicit logout" case.
  await db.pushDevice.upsert({
    where: { token },
    create: {
      token,
      userId: user.id,
      platform,
      appVersion: appVersion ?? null,
    },
    update: {
      userId: user.id,
      platform,
      appVersion: appVersion ?? null,
      lastSeenAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Body shape mirrors POST — the client sends the token it wants to
  // unregister. Scoped to the current user so a stolen token can't
  // unregister someone else's device.
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

  await db.pushDevice.deleteMany({
    where: { token: parsed.data.token, userId: user.id },
  });

  return NextResponse.json({ ok: true });
}
