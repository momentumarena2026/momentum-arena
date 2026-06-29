import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { searchUsersForPush } from "@/actions/admin-push";

/**
 * GET /api/mobile/admin/push/users?q=...
 *
 * Customer lookup for the broadcast composer's "specific user" audience.
 * Mirrors the web form's searchUsersForPush: matches name / phone and
 * returns each match's reachable device count + platforms. Min 2 chars
 * (enforced again in the action) so a single keystroke can't enumerate
 * the whole user table.
 *
 * Bearer auth + MANAGE_PUSH (same gate as the rest of /admin/push).
 */
export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_PUSH");
  if ("error" in gate) return gate.error;

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ users: [] });
  }

  const users = await searchUsersForPush(q, true);
  return NextResponse.json({ users });
}
