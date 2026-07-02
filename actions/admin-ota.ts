"use server";

import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import type { OtaPlatform, OtaReleaseStatus } from "@prisma/client";

// OTA management is a privileged operational surface (it changes what
// JS bundle every installed app downloads), so it has its own dedicated
// MANAGE_APP_RELEASES permission (shared with the release-flow dashboard
// and app-version gates). Superadmins bypass per-permission checks in
// requireAdmin.
async function requireAdmin() {
  const user = await requireAdminBase("MANAGE_APP_RELEASES");
  return user.id;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Auth options for the mutating actions below.
 *
 * Web call-sites omit this → `skipAuth` is false → the action runs the
 * cookie-based `requireAdmin()` exactly as before. The mobile admin route
 * (app/api/mobile/admin/ota) has ALREADY authorized the request via bearer
 * token + MANAGE_APP_RELEASES (getMobileAdmin/hasPermission), so it passes
 * `{ skipAuth: true, adminId: admin.id }` — mirroring the `skipAuth` option
 * the read action `listOtaReleases` already exposes. The resolved adminId is
 * used wherever a release row stamps `publishedBy`, so skipAuth callers still
 * attribute the rollout/rollback correctly.
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
 * relations. One entry per release; the page groups by (channel, platform).
 */
export interface OtaReleaseRow {
  id: string;
  channel: string;
  runtimeVersion: string;
  platform: OtaPlatform;
  kind: "UPDATE" | "ROLLBACK";
  status: OtaReleaseStatus;
  rolloutPercent: number;
  sequence: number;
  changelog: string | null;
  publishedBy: string | null;
  assetCount: number;
  createdAt: Date;
  activatedAt: Date | null;
}

/**
 * List every OTA release (newest-first per slot).
 *
 * `skipAuth` lets a call-site that has ALREADY authorized the request via a
 * different mechanism reuse this query without the cookie-session check. The
 * mobile admin route (app/api/mobile/admin/ota) authenticates with a bearer
 * token + MANAGE_APP_RELEASES via getMobileAdmin/hasPermission, so it passes
 * `skipAuth: true` — the cookie-based requireAdmin() would otherwise reject a
 * mobile request that has no admin session cookie.
 */
export async function listOtaReleases({
  skipAuth = false,
}: { skipAuth?: boolean } = {}): Promise<OtaReleaseRow[]> {
  if (!skipAuth) await requireAdmin();

  const releases = await db.otaRelease.findMany({
    // Group key first (channel → platform → runtimeVersion), newest
    // release within each slot first so the active build floats to top.
    orderBy: [
      { channel: "asc" },
      { platform: "asc" },
      { runtimeVersion: "desc" },
      { createdAt: "desc" },
    ],
    include: {
      _count: { select: { assets: true } },
    },
  });

  return releases.map((r) => ({
    id: r.id,
    channel: r.channel,
    runtimeVersion: r.runtimeVersion,
    platform: r.platform,
    kind: r.kind,
    status: r.status,
    rolloutPercent: r.rolloutPercent,
    sequence: r.sequence,
    changelog: r.changelog,
    publishedBy: r.publishedBy,
    assetCount: r._count.assets,
    createdAt: r.createdAt,
    activatedAt: r.activatedAt,
  }));
}

/**
 * Publish a release at a given rollout %. Only one PUBLISHED release is
 * allowed per (channel, platform, runtimeVersion) slot — any other live
 * one in the same slot is ARCHIVED (kept for history / rollback).
 */
export async function rolloutOtaRelease(
  releaseId: string,
  rolloutPercent: number,
  opts: AdminAuthOpts = {}
): Promise<{ success: true } | { error: string }> {
  const adminId = await resolveAdminId(opts);

  if (!releaseId) {
    return { error: "Release id is required" };
  }

  const percent = clampPercent(rolloutPercent);

  const release = await db.otaRelease.findUnique({ where: { id: releaseId } });
  if (!release) {
    return { error: "Release not found" };
  }
  if (release.status === "ARCHIVED") {
    return { error: "Archived releases can't be rolled out — use Roll back" };
  }

  // Guard against rolling out a release OLDER than the one that's currently
  // live in this slot. The manifest stamps each update with its createdAt,
  // and expo-updates refuses to load an update older than the running one —
  // so an older rollout never cleanly reverts (devices already on the newer
  // build stay put → fragmented fleet). To go back, use Roll back (to the
  // embedded bundle) or publish a new release. Adjusting the live release's
  // own % is fine (it's excluded via id-not-self, so `live` is null then).
  const live = await db.otaRelease.findFirst({
    where: {
      channel: release.channel,
      platform: release.platform,
      runtimeVersion: release.runtimeVersion,
      status: "PUBLISHED",
      id: { not: release.id },
    },
    select: { createdAt: true },
  });
  if (live && live.createdAt > release.createdAt) {
    return {
      error:
        "This release is older than the current live one — devices won't downgrade. Use Roll back, or publish a new release to go back.",
    };
  }

  // Demote any other currently-PUBLISHED release in the same slot so
  // only one is live at a time, while keeping its row for history.
  await db.otaRelease.updateMany({
    where: {
      channel: release.channel,
      platform: release.platform,
      runtimeVersion: release.runtimeVersion,
      status: "PUBLISHED",
      id: { not: release.id },
    },
    data: { status: "ARCHIVED" },
  });

  await db.otaRelease.update({
    where: { id: release.id },
    data: {
      status: "PUBLISHED",
      rolloutPercent: percent,
      publishedBy: adminId,
      // Stamp the first-ever activation only once.
      activatedAt: release.activatedAt ?? new Date(),
    },
  });

  revalidatePath("/admin/ota");
  return { success: true };
}

/**
 * Adjust the rollout % of an already-PUBLISHED release without changing
 * which release is live.
 */
export async function setOtaRolloutPercent(
  releaseId: string,
  percent: number,
  opts: AdminAuthOpts = {}
): Promise<{ success: true } | { error: string }> {
  await resolveAdminId(opts);

  if (!releaseId) {
    return { error: "Release id is required" };
  }

  const release = await db.otaRelease.findUnique({ where: { id: releaseId } });
  if (!release) {
    return { error: "Release not found" };
  }
  if (release.status !== "PUBLISHED") {
    return { error: "Only a published release can have its rollout adjusted" };
  }

  await db.otaRelease.update({
    where: { id: release.id },
    data: { rolloutPercent: clampPercent(percent) },
  });

  revalidatePath("/admin/ota");
  return { success: true };
}

/**
 * Roll back a release: ARCHIVE it and re-PUBLISH (at 100%) the most
 * recent previously-ARCHIVED UPDATE release in the same slot. If there's
 * no prior release to fall back to, we just archive this one.
 */
export async function rollbackOtaRelease(
  releaseId: string,
  opts: AdminAuthOpts = {}
): Promise<{ success: true } | { error: string }> {
  const adminId = await resolveAdminId(opts);

  if (!releaseId) {
    return { error: "Release id is required" };
  }

  const release = await db.otaRelease.findUnique({ where: { id: releaseId } });
  if (!release) {
    return { error: "Release not found" };
  }

  await db.otaRelease.update({
    where: { id: release.id },
    data: { status: "ARCHIVED" },
  });

  // Most recent previously-archived UPDATE in the same slot becomes the
  // new live build. ROLLBACK-kind releases are skipped — re-serving a
  // rollback directive isn't a meaningful "previous good build". We query
  // AFTER archiving the current release; the `id: { not: ... }` guard
  // keeps it out of the candidate set regardless.
  const previous = await db.otaRelease.findFirst({
    where: {
      channel: release.channel,
      platform: release.platform,
      runtimeVersion: release.runtimeVersion,
      kind: "UPDATE",
      status: "ARCHIVED",
      id: { not: release.id },
    },
    orderBy: { createdAt: "desc" },
  });

  if (previous) {
    await db.otaRelease.update({
      where: { id: previous.id },
      data: {
        status: "PUBLISHED",
        rolloutPercent: 100,
        publishedBy: adminId,
        activatedAt: previous.activatedAt ?? new Date(),
      },
    });
  }

  revalidatePath("/admin/ota");
  return { success: true };
}

export async function archiveOtaRelease(
  releaseId: string,
  opts: AdminAuthOpts = {}
): Promise<{ success: true } | { error: string }> {
  await resolveAdminId(opts);

  if (!releaseId) {
    return { error: "Release id is required" };
  }

  const release = await db.otaRelease.findUnique({ where: { id: releaseId } });
  if (!release) {
    return { error: "Release not found" };
  }

  await db.otaRelease.update({
    where: { id: release.id },
    data: { status: "ARCHIVED" },
  });

  revalidatePath("/admin/ota");
  return { success: true };
}
