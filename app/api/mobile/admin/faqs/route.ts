import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";

/**
 * Mobile admin FAQs. Mirrors actions/admin-faqs.ts (getAllFAQs +
 * createFAQ) with bearer auth + the MANAGE_FAQS permission
 * (SUPERADMIN bypass).
 */
async function guard(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_FAQS")
  ) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

export async function GET(request: NextRequest) {
  const auth = await guard(request);
  if ("error" in auth) return auth.error;

  const faqs = await db.fAQEntry.findMany({
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
  });
  return NextResponse.json({ faqs });
}

const createSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  keywords: z.array(z.string()).default([]),
  category: z.string().min(1),
  sortOrder: z.number().int().default(0),
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

  await db.fAQEntry.create({
    data: {
      question: parsed.data.question,
      answer: parsed.data.answer,
      keywords: parsed.data.keywords,
      category: parsed.data.category,
      sortOrder: parsed.data.sortOrder,
    },
  });
  return NextResponse.json({ ok: true });
}
