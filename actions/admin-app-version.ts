"use server";

import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import type { OtaPlatform } from "@prisma/client";

// The native version gate lives on the same operational surface as OTA
// (it can hard-block every installed app behind an "Update Required"
// screen), so it's gated behind the same MANAGE_PRICING permission the
// OTA actions use. Superadmins bypass per-permission checks in
// requireAdmin.
async function requireAdmin() {
  const user = await requireAdminBase("MANAGE_PRICING");
  return user.id;
}

const PLATFORMS: OtaPlatform[] = ["ios", "android"];
const CHANNELS = ["development", "production"] as const;

function toBuild(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function isPlatform(value: string): value is OtaPlatform {
  return (PLATFORMS as string[]).includes(value);
}

function isChannel(value: string): value is (typeof CHANNELS)[number] {
  return (CHANNELS as readonly string[]).includes(value);
}

/**
 * Auth options for the mutating actions below.
 *
 * Web call-sites omit this → `skipAuth` is false → the action runs the
 * cookie-based `requireAdmin()` exactly as before. The mobile admin route
 * (app/api/mobile/admin/ota) has ALREADY authorized the request via bearer
 * token + MANAGE_PRICING (getMobileAdmin/hasPermission), so it passes
 * `{ skipAuth: true, adminId: admin.id }` — mirroring the `skipAuth` option
 * the read action `listAppVersionGates` already exposes. The resolved adminId
 * is stamped onto the gate's `updatedBy` so skipAuth callers attribute the
 * edit correctly.
 */
interface AdminAuthOpts {
  skipAuth?: boolean;
  adminId?: string;
}

async function resolveAdminId(opts: AdminAuthOpts): Promise<string> {
  if (opts.skipAuth) return opts.adminId!;
  return requireAdmin();
}

/**
 * Public, serializable shape so the client never sees Prisma-internal
 * fields. One entry per existing AppVersionGate row; the page renders an
 * editor (or a "create" prompt) for every (platform × channel) slot.
 */
export interface AppVersionGateRow {
  id: string;
  platform: OtaPlatform;
  channel: string;
  latestBuild: number;
  latestVersionName: string | null;
  minSupportedBuild: number;
  storeUrl: string;
  message: string | null;
  updatedBy: string | null;
  updatedAt: Date;
}

/**
 * List every native version gate.
 *
 * `skipAuth` lets a caller that has already authorized the request reuse this
 * query without the cookie-session check. The mobile admin route
 * (app/api/mobile/admin/ota) authenticates via bearer token + MANAGE_PRICING
 * (getMobileAdmin/hasPermission) and passes `skipAuth: true`, since the
 * cookie-based requireAdmin() would reject a mobile request with no session.
 */
export async function listAppVersionGates({
  skipAuth = false,
}: { skipAuth?: boolean } = {}): Promise<AppVersionGateRow[]> {
  if (!skipAuth) await requireAdmin();

  const gates = await db.appVersionGate.findMany({
    orderBy: [{ channel: "asc" }, { platform: "asc" }],
  });

  return gates.map((g) => ({
    id: g.id,
    platform: g.platform,
    channel: g.channel,
    latestBuild: g.latestBuild,
    latestVersionName: g.latestVersionName,
    minSupportedBuild: g.minSupportedBuild,
    storeUrl: g.storeUrl,
    message: g.message,
    updatedBy: g.updatedBy,
    updatedAt: g.updatedAt,
  }));
}

/**
 * Create or update the gate for a (platform, channel) slot. Editing the
 * "latest store build" metadata never changes minSupportedBuild — forcing
 * is a separate, deliberate action (forceUpdateToLatest / setMinSupportedBuild).
 */
export async function upsertAppVersionGate(
  input: {
    platform: string;
    channel: string;
    latestBuild: number;
    latestVersionName: string;
    storeUrl: string;
    message: string;
  },
  opts: AdminAuthOpts = {}
): Promise<{ success: true } | { error: string }> {
  const adminId = await resolveAdminId(opts);

  if (!isPlatform(input.platform)) {
    return { error: "Invalid platform" };
  }
  if (!isChannel(input.channel)) {
    return { error: "Invalid channel" };
  }

  const storeUrl = input.storeUrl.trim();
  if (!storeUrl) {
    return { error: "Store URL is required" };
  }

  const latestBuild = toBuild(input.latestBuild);
  const latestVersionName = input.latestVersionName.trim() || null;
  const message = input.message.trim() || null;

  await db.appVersionGate.upsert({
    where: {
      platform_channel: { platform: input.platform, channel: input.channel },
    },
    update: {
      latestBuild,
      latestVersionName,
      storeUrl,
      message,
      updatedBy: adminId,
    },
    create: {
      platform: input.platform,
      channel: input.channel,
      latestBuild,
      latestVersionName,
      storeUrl,
      message,
      // A brand-new gate never forces by default — min stays at 0 until an
      // admin explicitly raises it once the build is live on the store.
      minSupportedBuild: 0,
      updatedBy: adminId,
    },
  });

  revalidatePath("/admin/ota");
  return { success: true };
}

/**
 * Directly set minSupportedBuild for a slot. Used both to force (raise to
 * latest, usually via forceUpdateToLatest) and to un-force / lower it.
 */
export async function setMinSupportedBuild(
  platform: string,
  channel: string,
  minSupportedBuild: number,
  opts: AdminAuthOpts = {}
): Promise<{ success: true } | { error: string }> {
  const adminId = await resolveAdminId(opts);

  if (!isPlatform(platform)) {
    return { error: "Invalid platform" };
  }
  if (!isChannel(channel)) {
    return { error: "Invalid channel" };
  }

  const gate = await db.appVersionGate.findUnique({
    where: { platform_channel: { platform, channel } },
  });
  if (!gate) {
    return { error: "No version gate for this platform/channel yet" };
  }

  const min = toBuild(minSupportedBuild);
  if (min > gate.latestBuild) {
    return {
      error:
        "Minimum can't exceed the latest store build — bump latestBuild first",
    };
  }

  await db.appVersionGate.update({
    where: { id: gate.id },
    data: { minSupportedBuild: min, updatedBy: adminId },
  });

  revalidatePath("/admin/ota");
  return { success: true };
}

/**
 * Force update: set minSupportedBuild = latestBuild so every install below
 * the newest store build hits the blocking "Update Required" screen. Only
 * safe AFTER that build is actually live on the App Store / Play Store.
 */
export async function forceUpdateToLatest(
  platform: string,
  channel: string,
  opts: AdminAuthOpts = {}
): Promise<{ success: true } | { error: string }> {
  const adminId = await resolveAdminId(opts);

  if (!isPlatform(platform)) {
    return { error: "Invalid platform" };
  }
  if (!isChannel(channel)) {
    return { error: "Invalid channel" };
  }

  const gate = await db.appVersionGate.findUnique({
    where: { platform_channel: { platform, channel } },
  });
  if (!gate) {
    return { error: "No version gate for this platform/channel yet" };
  }

  await db.appVersionGate.update({
    where: { id: gate.id },
    data: { minSupportedBuild: gate.latestBuild, updatedBy: adminId },
  });

  revalidatePath("/admin/ota");
  return { success: true };
}
