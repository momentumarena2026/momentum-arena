import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";

/**
 * Mobile-admin CRUD for the trusted-device allowlist (the 5-tap admin
 * entry gate) — bearer twin of actions/admin-trusted-devices.ts, same
 * MANAGE_TRUSTED_DEVICES permission (superadmins always pass).
 *
 *   GET    → { devices: [...] }
 *   POST   { deviceId, label, platform? } → add (MANUAL)
 *   PATCH  { id, label }                  → rename
 *   DELETE ?id=                           → remove
 */

async function guard(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin)
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_TRUSTED_DEVICES")
  ) {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { admin };
}

export async function GET(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;

  const devices = await db.trustedDevice.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    devices: devices.map((d) => ({
      id: d.id,
      deviceId: d.deviceId,
      label: d.label,
      platform: d.platform,
      source: d.source,
      createdAt: d.createdAt.toISOString(),
      lastSeenAt: d.lastSeenAt.toISOString(),
    })),
  });
}

const AddSchema = z.object({
  deviceId: z.string().trim().min(1).max(128),
  label: z.string().trim().min(1).max(120),
  platform: z.string().trim().max(20).optional(),
});

export async function POST(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;

  const parsed = AddSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Device ID and label are required" },
      { status: 400 },
    );
  }

  const existing = await db.trustedDevice.findUnique({
    where: { deviceId: parsed.data.deviceId },
  });
  if (existing) {
    return NextResponse.json(
      { error: `Already registered as “${existing.label}”.` },
      { status: 409 },
    );
  }

  await db.trustedDevice.create({
    data: {
      deviceId: parsed.data.deviceId,
      label: parsed.data.label,
      platform: parsed.data.platform || null,
      source: "MANUAL",
    },
  });
  return NextResponse.json({ ok: true });
}

const RenameSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(120),
});

export async function PATCH(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;

  const parsed = RenameSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Label is required" }, { status: 400 });
  }

  await db.trustedDevice.update({
    where: { id: parsed.data.id },
    data: { label: parsed.data.label },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  await db.trustedDevice.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
