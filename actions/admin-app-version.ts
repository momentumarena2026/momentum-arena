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

export async function listAppVersionGates(): Promise<AppVersionGateRow[]> {
  await requireAdmin();

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
export async function upsertAppVersionGate(input: {
  platform: string;
  channel: string;
  latestBuild: number;
  latestVersionName: string;
  storeUrl: string;
  message: string;
}): Promise<{ success: true } | { error: string }> {
  const adminId = await requireAdmin();

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
  minSupportedBuild: number
): Promise<{ success: true } | { error: string }> {
  const adminId = await requireAdmin();

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
  channel: string
): Promise<{ success: true } | { error: string }> {
  const adminId = await requireAdmin();

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
