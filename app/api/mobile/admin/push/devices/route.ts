import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import {
  getPushDevices,
  deletePushDeviceById,
  pruneStalePushDevices,
} from "@/actions/admin-push";

/**
 * Registered customer push-device management for the mobile admin app —
 * mirrors the web /admin/push "Registered devices" table + its
 * DeleteDeviceButton / PruneStaleButton maintenance actions.
 *
 *   GET    ?platform=&page=&limit=  → paginated device list (platform,
 *                                     app version, masked token, last-seen)
 *   DELETE { id }                   → revoke (unregister) one device token
 *   DELETE { pruneStale: true }     → bulk-prune devices idle 90+ days
 *
 * All reuse the same web actions the dashboard calls, with skipAuth=true
 * since we already guard MANAGE_PUSH here via the JWT.
 */
const STALE_DAYS = 90;

export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_PUSH");
  if ("error" in gate) return gate.error;

  const url = new URL(request.url);
  const platform = url.searchParams.get("platform") ?? undefined;
  const page = Number(url.searchParams.get("page") ?? "1");
  const limit = Number(url.searchParams.get("limit") ?? "25");

  const result = await getPushDevices(
    {
      platform: platform === "android" || platform === "ios" ? platform : undefined,
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 25,
    },
    true,
  );

  return NextResponse.json({
    devices: result.devices.map((d) => ({
      id: d.id,
      platform: d.platform,
      appVersion: d.appVersion,
      tokenPreview: d.tokenPreview,
      lastSeenAt: d.lastSeenAt.toISOString(),
      createdAt: d.createdAt.toISOString(),
      userId: d.userId,
      userName: d.userName,
      userPhone: d.userPhone,
    })),
    total: result.total,
    page: result.page,
    totalPages: result.totalPages,
  });
}

const deleteSchema = z.union([
  z.object({ id: z.string().min(1) }),
  z.object({ pruneStale: z.literal(true) }),
]);

export async function DELETE(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_PUSH");
  if ("error" in gate) return gate.error;

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide a device id or pruneStale: true" },
      { status: 400 },
    );
  }

  if ("pruneStale" in parsed.data) {
    const r = await pruneStalePushDevices(STALE_DAYS, true);
    return NextResponse.json({ ok: true, deleted: r.deleted });
  }

  try {
    await deletePushDeviceById(parsed.data.id, true);
  } catch {
    // Already gone (e.g. pruned or the user uninstalled) — treat as success
    // so the client can optimistically drop the row either way.
    return NextResponse.json({ ok: true, deleted: 0 });
  }
  return NextResponse.json({ ok: true, deleted: 1 });
}
