import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";

/**
 * GET → list alerts (status filter via ?status=OPEN|DISMISSED|ACTIONED)
 * POST → update an alert's status. Body: { id, status, resolution? }
 *
 * Both gated on MANAGE_REWARDS (SUPERADMIN bypass).
 */

async function gate(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) return { admin: null, error: 401 } as const;
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_REWARDS")
  ) {
    return { admin: null, error: 403 } as const;
  }
  return { admin, error: null } as const;
}

export async function GET(request: NextRequest) {
  const { admin, error } = await gate(request);
  if (error) {
    return NextResponse.json({ error: "Forbidden" }, { status: error });
  }
  void admin;

  const status =
    (request.nextUrl.searchParams.get("status") as
      | "OPEN"
      | "DISMISSED"
      | "ACTIONED"
      | null) ?? "OPEN";

  const rows = await db.rewardAlert.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      user: { select: { id: true, name: true, phone: true } },
    },
  });

  return NextResponse.json({
    alerts: rows.map((a) => ({
      id: a.id,
      kind: a.kind,
      severity: a.severity,
      status: a.status,
      details: a.details,
      createdAt: a.createdAt.toISOString(),
      user: a.user,
    })),
  });
}

const updateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["DISMISSED", "ACTIONED"]),
  resolution: z.string().max(500).optional(),
});

export async function POST(request: NextRequest) {
  const { admin, error } = await gate(request);
  if (error) {
    return NextResponse.json({ error: "Forbidden" }, { status: error });
  }
  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  await db.rewardAlert.update({
    where: { id: parsed.data.id },
    data: {
      status: parsed.data.status,
      resolution: parsed.data.resolution ?? null,
      resolvedAt: new Date(),
      resolvedBy: admin!.id,
    },
  });
  return NextResponse.json({ ok: true });
}
