import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import {
  getDailyPushAdminView,
  saveDailyPushSettings,
  dryRunDailyPush,
} from "@/actions/admin-daily-push";
import { type DailyPushLimits } from "@/lib/daily-push-rules";

/**
 * Mobile admin — the daily push.
 *
 * GET               → DailyPushAdminView (settings + reach + last week)
 * POST { settings } → { ok } | 400 { error } from settingsRefusal
 * POST { dryRun }   → the run report, having sent nothing
 *
 * Permission: MANAGE_PUSH, mirroring /admin/push/daily on the web.
 *
 * Both surfaces call the SAME server actions, so the validator that
 * refuses an incoherent combination is one function rather than two
 * — the venue cannot save from their phone something the web would
 * have rejected.
 */
export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_PUSH");
  if ("error" in gate) return gate.error;
  return NextResponse.json(await getDailyPushAdminView());
}

export async function POST(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_PUSH");
  if ("error" in gate) return gate.error;

  const body = (await request.json().catch(() => null)) as {
    dryRun?: boolean;
    settings?: DailyPushLimits;
  } | null;

  if (body?.dryRun) {
    return NextResponse.json(await dryRunDailyPush());
  }

  if (!body?.settings) {
    return NextResponse.json(
      { error: "Expected { settings } or { dryRun: true }" },
      { status: 400 },
    );
  }

  const result = await saveDailyPushSettings(body.settings);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json(await getDailyPushAdminView());
}
