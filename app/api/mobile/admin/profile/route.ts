import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import {
  getAdminProfile,
  updateAdminProfile,
  type UpdateAdminProfileInput,
} from "@/actions/admin-profile";

/**
 * "My profile" — the signed-in admin views and edits their OWN account
 * (username / email / password) and sees role, permissions and last-login.
 * Available to every authenticated admin (no extra permission gate). The
 * caller's adminId comes from the validated bearer token, so an admin can only
 * ever read/write their own row.
 */
export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const profile = await getAdminProfile(admin.id);
  return NextResponse.json({ profile });
}

export async function PATCH(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | UpdateAdminProfileInput
    | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const profile = await updateAdminProfile(admin.id, body);
    return NextResponse.json({ profile });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update profile" },
      { status: 400 },
    );
  }
}
