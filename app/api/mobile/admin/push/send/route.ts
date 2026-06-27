import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { sendBroadcast } from "@/actions/admin-push";

/**
 * Mobile admin push send. Reuses actions/admin-push.ts `sendBroadcast`
 * — the same code path the web /admin/push form uses — but since the
 * mobile client authenticates with a bearer JWT (getMobileAdmin) and
 * has no NextAuth web session, we guard MANAGE_PUSH here and pass the
 * verified AdminUser.id via `adminOverride` so sendBroadcast skips its
 * own requireAdmin() session check while still attributing the send.
 *
 * Body: { title, body, screen? } where screen ∈ home|book|cafe|shop|
 * rewards. Audience is always "all devices" on mobile (the web form's
 * group/user targeting needs richer pickers; broadcast-to-all covers
 * the on-the-go use case).
 */
const sendSchema = z.object({
  title: z.string().min(1).max(100),
  body: z.string().min(1).max(500),
  screen: z.enum(["home", "book", "cafe", "shop", "rewards"]).optional(),
});

export async function POST(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_PUSH")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = sendSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid data" },
      { status: 400 },
    );
  }

  const result = await sendBroadcast({
    audience: { kind: "all" },
    title: parsed.data.title,
    body: parsed.data.body,
    destination: parsed.data.screen,
    adminOverride: { id: admin.id },
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    attempted: result.attempted,
    succeeded: result.succeeded,
    failed: result.failed,
    cleanedUp: result.cleanedUp,
  });
}
