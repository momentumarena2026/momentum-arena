import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { getAllSportsWithConfigs } from "@/actions/admin-slots";
import type { Sport } from "@prisma/client";

/**
 * Mobile admin sports management. Mirrors actions/admin-slots.ts —
 * getAllSportsWithConfigs (read, has a skipAuth flag) + toggleSportActive /
 * toggleConfigActive (write, replicated here) under MANAGE_SPORTS.
 */
async function guard(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_SPORTS")
  ) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

export async function GET(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;
  const configs = await getAllSportsWithConfigs(true);
  return NextResponse.json({ configs });
}

export async function POST(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body.isActive !== "boolean") {
    return NextResponse.json({ error: "isActive is required" }, { status: 400 });
  }
  if (body.configId) {
    await db.courtConfig.update({
      where: { id: String(body.configId) },
      data: { isActive: body.isActive },
    });
  } else if (body.sport) {
    await db.courtConfig.updateMany({
      where: { sport: body.sport as Sport },
      data: { isActive: body.isActive },
    });
  } else {
    return NextResponse.json(
      { error: "configId or sport is required" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
