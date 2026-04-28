import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { signMobileAdminToken } from "@/lib/mobile-auth";

/**
 * Mobile admin login. Mirrors the web /godmode flow but issues a
 * bearer-token JWT instead of a NextAuth cookie session.
 *
 * Rate limit: 5 failed attempts per username per 15 minutes — same
 * pattern as actions/admin-auth.ts:adminLogin so the two surfaces
 * can't be played against each other to brute-force admin passwords.
 */

const Schema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

const RATE_LIMIT_ACTION = "admin-mobile-login";
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Username and password are required" },
      { status: 400 },
    );
  }

  const username = parsed.data.username.trim();
  const password = parsed.data.password;

  // Rate-limit identifier is "admin-mobile:<username>" so an attacker
  // probing different usernames doesn't share a counter with web logins.
  const rateKey = `admin-mobile:${username}`;
  const fifteenMinAgo = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const rateEntry = await db.rateLimit.findUnique({
    where: { identifier_action: { identifier: rateKey, action: RATE_LIMIT_ACTION } },
  });
  if (
    rateEntry &&
    rateEntry.windowStart > fifteenMinAgo &&
    rateEntry.count >= RATE_LIMIT_MAX
  ) {
    return NextResponse.json(
      { error: "Too many login attempts. Try again in 15 minutes." },
      { status: 429 },
    );
  }

  const admin = await db.adminUser.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      permissions: true,
      passwordHash: true,
    },
  });

  // Same error string for "user not found" and "bad password" so we
  // don't leak which usernames exist.
  const ok = admin && (await verifyPassword(password, admin.passwordHash));
  if (!ok || !admin) {
    // Increment rate-limit only on failure; success path resets it.
    await db.rateLimit.upsert({
      where: {
        identifier_action: { identifier: rateKey, action: RATE_LIMIT_ACTION },
      },
      create: {
        identifier: rateKey,
        action: RATE_LIMIT_ACTION,
        count: 1,
        windowStart: new Date(),
      },
      update:
        rateEntry && rateEntry.windowStart > fifteenMinAgo
          ? { count: { increment: 1 } }
          : { count: 1, windowStart: new Date() },
    });
    return NextResponse.json(
      { error: "Invalid username or password" },
      { status: 401 },
    );
  }

  // Successful login — clear the failure counter so the next attempt
  // doesn't carry over a stale count.
  await db.rateLimit
    .deleteMany({
      where: { identifier: rateKey, action: RATE_LIMIT_ACTION },
    })
    .catch(() => {});

  // Update lastLoginAt for the audit log on the admin profile page.
  await db.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
  });

  const token = signMobileAdminToken(admin);

  return NextResponse.json({
    token,
    admin: {
      id: admin.id,
      username: admin.username,
      email: admin.email,
      role: admin.role,
      permissions: admin.permissions,
    },
  });
}
