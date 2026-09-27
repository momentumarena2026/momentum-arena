import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import {
  getDailyPushLibrary,
  saveDailyPushLine,
  deleteDailyPushLine,
} from "@/actions/admin-daily-push";

/**
 * Mobile admin — the creative line library.
 *
 * GET               → DailyPushLibraryView
 * POST { line }     → save (create or edit), then the refreshed view
 * POST { deleteId } → delete, then the refreshed view
 *
 * Occasion dates are deliberately NOT editable here. Setting a festival
 * window is a once-a-year job done with a calendar to hand, and a date
 * picker on a phone is the wrong instrument for the one input nobody
 * can sanity-check afterwards — a wrong Holi date means the copy lands
 * on the wrong day and nothing says so. The app surfaces which tags are
 * undated so the gap is visible; filling it is a web job.
 *
 * Permission: MANAGE_PUSH, same as every other push surface.
 */
export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_PUSH");
  if ("error" in gate) return gate.error;
  return NextResponse.json(await getDailyPushLibrary());
}

export async function POST(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_PUSH");
  if ("error" in gate) return gate.error;

  const body = (await request.json().catch(() => null)) as {
    deleteId?: string;
    line?: { id?: string; title: string; body: string; tags: string[]; enabled: boolean };
  } | null;

  if (body?.deleteId) {
    const r = await deleteDailyPushLine(body.deleteId);
    if (!r.ok) return NextResponse.json({ error: r.error ?? "Failed" }, { status: 400 });
    return NextResponse.json(await getDailyPushLibrary());
  }

  if (!body?.line) {
    return NextResponse.json({ error: "Expected { line } or { deleteId }" }, { status: 400 });
  }

  const r = await saveDailyPushLine(body.line);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json(await getDailyPushLibrary());
}
