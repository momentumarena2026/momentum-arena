import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileUser } from "@/lib/mobile-auth";

/**
 * What the customer has chosen to hear about.
 *
 * Its own route rather than another field on PATCH /api/mobile/me,
 * because that endpoint answers with the auth user and the app feeds its
 * response straight back into the session. A preference toggle has no
 * business round-tripping the identity the app is signed in with.
 *
 * ── SCOPE, DELIBERATELY NARROW ────────────────────────────────────────
 * `offers` covers the scheduled daily push and nothing else. Booking
 * confirmations, reminders, refunds, cafe orders and match updates
 * ignore it entirely. Someone switching off marketing has not asked to
 * stop being told that the court they paid for is confirmed, and a
 * single "notifications" switch that silenced both would push them to
 * the OS-level toggle instead — which kills everything, permanently,
 * somewhere we cannot see or undo.
 * ──────────────────────────────────────────────────────────────────────
 */

export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const row = await db.user.findUnique({
    where: { id: user.id },
    select: { offersOptOut: true },
  });

  return NextResponse.json({ offers: !(row?.offersOptOut ?? false) });
}

export async function PATCH(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { offers?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (typeof body.offers !== "boolean") {
    return NextResponse.json(
      { error: "Expected { offers: boolean }" },
      { status: 400 },
    );
  }

  // Stored as an opt-OUT so an existing row with no value means "in",
  // which is the behaviour the venue expects without a backfill.
  const updated = await db.user.update({
    where: { id: user.id },
    data: { offersOptOut: !body.offers },
    select: { offersOptOut: true },
  });

  return NextResponse.json({ offers: !updated.offersOptOut });
}
