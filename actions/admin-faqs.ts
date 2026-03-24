"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";

async function requireAdmin() {
  const user = await requireAdminBase("MANAGE_FAQS");
  return user.id;
}

const faqSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  keywords: z.array(z.string()).default([]),
  category: z.string().min(1),
  sortOrder: z.number().int().default(0),
});

export async function createFAQ(data: {
  question: string;
  answer: string;
  keywords?: string[];
  category: string;
  sortOrder?: number;
}) {
  await requireAdmin();

  const parsed = faqSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Invalid data" };
  }

  await db.fAQEntry.create({
    data: {
      question: parsed.data.question,
      answer: parsed.data.answer,
      keywords: parsed.data.keywords,
      category: parsed.data.category,
      sortOrder: parsed.data.sortOrder,
    },
  });

  return { success: true };
}

export async function updateFAQ(
  id: string,
  data: Partial<{
    question: string;
    answer: string;
    keywords: string[];
    category: string;
    sortOrder: number;
    isActive: boolean;
  }>
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  try {
    await db.fAQEntry.update({ where: { id }, data });
    return { success: true };
  } catch {
    return { success: false, error: "Failed to update FAQ" };
  }
}

export async function deleteFAQ(id: string) {
  await requireAdmin();
  await db.fAQEntry.delete({ where: { id } });
  return { success: true };
}

export async function getAllFAQs() {
  await requireAdmin();
  return db.fAQEntry.findMany({
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
  });
}

// Public: get active FAQs for the chatbot/FAQ page
export async function getPublicFAQs() {
  return db.fAQEntry.findMany({
    where: { isActive: true },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
  });
}
