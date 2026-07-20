import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { sendBroadcast, type BroadcastAudience } from "@/actions/admin-push";

/**
 * Mobile admin push send. Reuses actions/admin-push.ts `sendBroadcast`
 * — the same code path the web /admin/push form uses. We guard
 * MANAGE_PUSH here so an unauthorized caller gets a proper 401/403 JSON
 * response; sendBroadcast independently re-enforces MANAGE_PUSH via
 * requireAdmin, which resolves this request's bearer JWT and attributes
 * the send to that verified identity.
 *
 * Audience targeting now matches the web broadcast form:
 *   - { kind: "all" }                    → every registered device
 *   - { kind: "platform", platform }     → android | ios only
 *   - { kind: "group", groupId }         → a UserGroup cohort's devices
 *   - { kind: "user", userId }           → one customer's device(s)
 *
 * dryRun=true returns the recipient COUNT for the chosen audience
 * without sending — powers the composer's "Preview reach" button.
 */
const audienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }),
  z.object({
    kind: z.literal("platform"),
    platform: z.enum(["android", "ios"]),
  }),
  z.object({ kind: z.literal("group"), groupId: z.string().min(1) }),
  z.object({ kind: z.literal("user"), userId: z.string().min(1) }),
]);

const sendSchema = z.object({
  // Default to all-devices so older app builds (which only sent
  // title/body/screen) keep working unchanged.
  audience: audienceSchema.default({ kind: "all" }),
  title: z.string().min(1).max(100),
  body: z.string().min(1).max(500),
  screen: z.enum(["home", "book", "cafe", "shop", "rewards"]).optional(),
  dryRun: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_PUSH");
  if ("error" in gate) return gate.error;

  const parsed = sendSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid data" },
      { status: 400 },
    );
  }

  const result = await sendBroadcast({
    audience: parsed.data.audience as BroadcastAudience,
    title: parsed.data.title,
    body: parsed.data.body,
    destination: parsed.data.screen,
    dryRun: parsed.data.dryRun,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    dryRun: result.dryRun,
    attempted: result.attempted,
    succeeded: result.succeeded,
    failed: result.failed,
    cleanedUp: result.cleanedUp,
  });
}
