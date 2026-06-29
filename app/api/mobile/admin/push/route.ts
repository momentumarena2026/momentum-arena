import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { getActiveUserGroupsForPush } from "@/actions/admin-push";

/**
 * Mobile admin push overview. Powers the AdminPushScreen header + the
 * broadcast composer's audience picker:
 *   - device reach (all / android / ios) so the admin knows how many
 *     phones a broadcast will hit before composing one
 *   - stale-device count → drives the "prune stale" maintenance CTA,
 *     mirroring the web dashboard's PruneStaleButton
 *   - active user-groups (with reachable-device counts) so the admin can
 *     target a cohort, matching the web broadcast form's group picker
 *   - the most recent broadcast/test sends, read from PushDispatch
 *     (the analytics log written by lib/push.ts on every send). We use
 *     PushDispatch rather than the Notification table because the
 *     latter is keyed on bookingId and only records per-booking event
 *     pushes, never admin broadcasts.
 *
 * Bearer auth + MANAGE_PUSH (SUPERADMIN bypass), mirroring the web
 * /admin/push dashboard which guards the same permission.
 */
const STALE_DAYS = 90;

export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_PUSH");
  if ("error" in gate) return gate.error;

  const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

  const [allDevices, androidDevices, iosDevices, staleDevices, recent, groups] =
    await Promise.all([
      db.pushDevice.count(),
      db.pushDevice.count({ where: { platform: "android" } }),
      db.pushDevice.count({ where: { platform: "ios" } }),
      db.pushDevice.count({ where: { lastSeenAt: { lt: staleCutoff } } }),
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
      // Reuse the web action (skipAuth — we already guarded MANAGE_PUSH).
      getActiveUserGroupsForPush(true),
    ]);

  return NextResponse.json({
    reach: { all: allDevices, android: androidDevices, ios: iosDevices },
    staleDevices,
    groups,
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
