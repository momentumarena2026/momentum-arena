import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";

/**
 * Mobile admin push overview. Powers the AdminPushScreen header:
 *   - device reach (all / android / ios) so the admin knows how many
 *     phones a broadcast will hit before composing one
 *   - the most recent broadcast/test sends, read from PushDispatch
 *     (the analytics log written by lib/push.ts on every send). We use
 *     PushDispatch rather than the Notification table because the
 *     latter is keyed on bookingId and only records per-booking event
 *     pushes, never admin broadcasts.
 *
 * Bearer auth + MANAGE_PUSH (SUPERADMIN bypass), mirroring the web
 * /admin/push dashboard which guards the same permission.
 */
async function requirePushAdmin(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_PUSH")
  ) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

export async function GET(request: NextRequest) {
  const auth = await requirePushAdmin(request);
  if ("error" in auth) return auth.error;

  const [allDevices, androidDevices, iosDevices, recent] = await Promise.all([
    db.pushDevice.count(),
    db.pushDevice.count({ where: { platform: "android" } }),
    db.pushDevice.count({ where: { platform: "ios" } }),
    // Only admin-initiated sends (broadcasts + tests). Event pushes
    // (booking confirmations, reminders, …) are noise on this screen.
    db.pushDispatch.findMany({
      where: { source: { in: ["broadcast", "test"] } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        kind: true,
        source: true,
        audience: true,
        title: true,
        body: true,
        attempted: true,
        succeeded: true,
        failed: true,
        createdAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    reach: { all: allDevices, android: androidDevices, ios: iosDevices },
    recent: recent.map((r) => ({
      id: r.id,
      kind: r.kind,
      source: r.source,
      audience: r.audience,
      title: r.title,
      body: r.body,
      attempted: r.attempted,
      succeeded: r.succeeded,
      failed: r.failed,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
