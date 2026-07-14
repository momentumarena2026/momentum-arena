"use server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { revalidatePath } from "next/cache";

/**
 * Trusted-device allowlist for the app's hidden admin entry (the
 * 5-tap on the version footer). Managing WHO can even see the admin
 * login screen is admin-user management, so the same superadmin-only
 * permission gates it.
 *
 * Devices land here two ways:
 *  - MANUAL: pasted from the ID an untrusted device reveals after 12
 *    taps on its version footer;
 *  - LOGIN: auto-registered by a successful mobile admin login.
 */

const PERMISSION = "MANAGE_ADMIN_USERS" as const;

export async function getTrustedDevices() {
  await requireAdmin(PERMISSION);
  return db.trustedDevice.findMany({
    orderBy: { createdAt: "desc" },
  });
}

export async function addTrustedDevice(data: {
  deviceId: string;
  label: string;
  platform?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin(PERMISSION);

  const deviceId = data.deviceId.trim();
  const label = data.label.trim();
  if (!deviceId || deviceId.length > 128) {
    return { ok: false, error: "Device ID is required (max 128 chars)." };
  }
  if (!label || label.length > 120) {
    return { ok: false, error: "Label is required (max 120 chars)." };
  }

  const existing = await db.trustedDevice.findUnique({ where: { deviceId } });
  if (existing) {
    return { ok: false, error: `Already registered as “${existing.label}”.` };
  }

  await db.trustedDevice.create({
    data: {
      deviceId,
      label,
      platform: data.platform?.trim() || null,
      source: "MANUAL",
    },
  });
  revalidatePath("/admin/trusted-devices");
  return { ok: true };
}

export async function renameTrustedDevice(
  id: string,
  label: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin(PERMISSION);
  const trimmed = label.trim();
  if (!trimmed || trimmed.length > 120) {
    return { ok: false, error: "Label is required (max 120 chars)." };
  }
  await db.trustedDevice.update({ where: { id }, data: { label: trimmed } });
  revalidatePath("/admin/trusted-devices");
  return { ok: true };
}

export async function removeTrustedDevice(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin(PERMISSION);
  await db.trustedDevice.delete({ where: { id } }).catch(() => {});
  revalidatePath("/admin/trusted-devices");
  return { ok: true };
}
