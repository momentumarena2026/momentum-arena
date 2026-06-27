import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";

/**
 * Mobile admin FAQ edit/delete. Mirrors updateFAQ + deleteFAQ in
 * actions/admin-faqs.ts (DELETE is a hard delete, matching the web).
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

const patchSchema = z.object({
  question: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  keywords: z.array(z.string()).optional(),
  category: z.string().min(1).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await guard(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid data" },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const data: Record<string, unknown> = {};
  if (d.question !== undefined) data.question = d.question;
  if (d.answer !== undefined) data.answer = d.answer;
  if (d.keywords !== undefined) data.keywords = d.keywords;
  if (d.category !== undefined) data.category = d.category;
  if (d.sortOrder !== undefined) data.sortOrder = d.sortOrder;
  if (d.isActive !== undefined) data.isActive = d.isActive;

  try {
    await db.fAQEntry.update({ where: { id }, data });
  } catch {
    return NextResponse.json({ error: "Failed to update FAQ" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await guard(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;

  try {
    await db.fAQEntry.delete({ where: { id } });
  } catch {
    return NextResponse.json({ error: "Failed to delete FAQ" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
