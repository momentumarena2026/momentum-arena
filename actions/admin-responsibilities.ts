"use server";

import { z } from "zod";
import type { ResponsibilityItem } from "@prisma/client";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";

async function gate() {
  await requireAdmin("MANAGE_HR");
}

export type ResponsibilityItemDTO = {
  id: string;
  text: string;
  isActive: boolean;
  sortOrder: number;
};

function toDTO(r: ResponsibilityItem): ResponsibilityItemDTO {
  return { id: r.id, text: r.text, isActive: r.isActive, sortOrder: r.sortOrder };
}

const textSchema = z.string().trim().min(1, "Text is required").max(300);

export async function listResponsibilityItems(): Promise<ResponsibilityItemDTO[]> {
  await gate();
  const rows = await db.responsibilityItem.findMany({
    orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toDTO);
}

/** Active items only — for the Responsibility Letter picker. */
export async function listActiveResponsibilityItems(): Promise<ResponsibilityItemDTO[]> {
  await gate();
  const rows = await db.responsibilityItem.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toDTO);
}

export async function createResponsibilityItem(
  text: string
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const parsed = textSchema.safeParse(text);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Invalid text" };
  }
  const max = await db.responsibilityItem.aggregate({ _max: { sortOrder: true } });
  await db.responsibilityItem.create({
    data: { text: parsed.data, sortOrder: (max._max.sortOrder ?? 0) + 1 },
  });
  return { success: true };
}

export async function updateResponsibilityItem(
  id: string,
  text: string
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const parsed = textSchema.safeParse(text);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Invalid text" };
  }
  try {
    await db.responsibilityItem.update({ where: { id }, data: { text: parsed.data } });
    return { success: true };
  } catch {
    return { success: false, error: "Failed to update item" };
  }
}

export async function setResponsibilityItemActive(
  id: string,
  isActive: boolean
): Promise<{ success: boolean; error?: string }> {
  await gate();
  try {
    await db.responsibilityItem.update({ where: { id }, data: { isActive } });
    return { success: true };
  } catch {
    return { success: false, error: "Failed to update item" };
  }
}

export async function getResponsibilityRecords() {
  await gate();
  return db.responsibilityLetterRecord.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
