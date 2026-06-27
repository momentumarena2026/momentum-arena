import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import {
  getBowlingMachineSettings,
  setBowlingMachineEnabled,
  setBowlingMachineHalf,
  updateBowlingMachineWindows,
  type BowlingHalf,
  type WindowInput,
} from "@/actions/admin-bowling-machine";

/**
 * Mobile admin bowling-machine settings. Reuses the web actions via their
 * skipAuth flag (read + enable/half/windows writes keep all the validation,
 * zone-swap and transaction logic) under MANAGE_SPORTS.
 */
async function guard(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_SPORTS")
  ) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

export async function GET(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;
  const settings = await getBowlingMachineSettings(true);
  return NextResponse.json({ settings });
}

export async function POST(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }

  let result: { success: boolean; error?: string };
  if (body.action === "enabled") {
    result = await setBowlingMachineEnabled(!!body.enabled, true);
  } else if (body.action === "half") {
    result = await setBowlingMachineHalf(body.half as BowlingHalf, true);
  } else if (body.action === "windows") {
    result = await updateBowlingMachineWindows(
      (body.windows ?? []) as WindowInput[],
      true,
    );
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  if (!result.success) {
    return NextResponse.json(
      { error: result.error ?? "Failed" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
