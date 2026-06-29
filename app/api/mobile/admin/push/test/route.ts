import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { sendTestPushToAdmin } from "@/actions/admin-push";

/**
 * POST /api/mobile/admin/push/test
 *
 * Self-test push: sends ONLY to the calling admin's own registered
 * device(s) (AdminPushDevice rows for gate.admin.id) — never to any
 * customer. Lets an on-the-go admin confirm FCM is wired end-to-end on
 * the very phone in their hand, and preview how a composed broadcast
 * will look on a lock screen, before firing a real broadcast.
 *
 * This is deliberately a separate route from /push/send so the UI can
 * make "test on my device" visually and behaviorally distinct from a
 * real, customer-facing broadcast.
 *
 * Optional { title, body } override the default test copy so the admin
 * can preview their actual composed message. Bearer auth + MANAGE_PUSH.
 */
const testSchema = z.object({
  title: z.string().max(100).optional(),
  body: z.string().max(500).optional(),
});

export async function POST(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_PUSH");
  if ("error" in gate) return gate.error;

  // Body is optional — an empty POST sends the default "hello world" test.
  const raw = await request.json().catch(() => ({}));
  const parsed = testSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid data" },
      { status: 400 },
    );
  }

  const result = await sendTestPushToAdmin(gate.admin.id, {
    title: parsed.data.title,
    body: parsed.data.body,
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
