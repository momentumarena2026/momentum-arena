import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { createUserGroup, listUserGroups } from "@/actions/admin-user-groups";

/**
 * Mobile admin user groups — named cohorts used for coupon/push
 * targeting. Wraps the web `listUserGroups` / `createUserGroup` server
 * actions. The guard below is the route's own boundary (proper 401/403
 * JSON); the actions independently re-check via requireAdmin, which
 * resolves the same bearer JWT in-process.
 *
 * Permission: MANAGE_COUPONS per the web sidebar grouping (SUPERADMIN
 * bypass).
 */
async function guard(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_COUPONS")
  ) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

export async function GET(request: NextRequest) {
  const auth = await guard(request);
  if ("error" in auth) return auth.error;

  const search = new URL(request.url).searchParams.get("search")?.trim() || undefined;

  try {
    const groups = await listUserGroups({ search });
    return NextResponse.json({ groups });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load groups" },
      { status: 500 },
    );
  }
}

const createSchema = z.object({
  name: z.string().min(1, "Group name is required").max(80),
  description: z.string().max(500).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await guard(request);
  if ("error" in auth) return auth.error;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid data" },
      { status: 400 },
    );
  }

  const result = await createUserGroup({
    name: parsed.data.name,
    description: parsed.data.description,
  });
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, groupId: result.groupId });
}
