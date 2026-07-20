import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import {
  getExpenseById,
  updateExpense,
  deleteExpense,
} from "@/actions/admin-expenses";

/**
 * GET /api/mobile/admin/expenses/[id]
 *   Single expense + edit history (for the detail / edit screen).
 *
 * PATCH /api/mobile/admin/expenses/[id]
 *   body: { ...ExpenseInput, note?: string }
 *   Updates the expense; the optional note attaches to the history row.
 *
 * DELETE /api/mobile/admin/expenses/[id]
 *   Hard-deletes the expense (cascades the history rows). Floor staff
 *   confirm in a native Alert before this fires.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_EXPENSES");
  if ("error" in gate) return gate.error;

  const { id } = await params;
  const expense = await getExpenseById(id);
  if (!expense) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    expense: {
      ...expense,
      date: expense.date.toISOString(),
      createdAt: expense.createdAt.toISOString(),
      updatedAt: expense.updatedAt.toISOString(),
      editHistory: expense.editHistory.map((h) => ({
        ...h,
        createdAt: h.createdAt.toISOString(),
      })),
    },
  });
}

const PatchBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1).max(500),
  amount: z.number().int().positive(),
  paymentType: z.string().min(1).max(100),
  doneBy: z.string().min(1).max(100),
  toName: z.string().min(1).max(200),
  // Required for GENERAL (action-level refine); RUNNING has no vendor field
  // and submits "". module rides along so updateExpense skips the vendor
  // requirement for RUNNING rows (it is parsed for validation, never written).
  vendor: z.string().max(100).optional().default(""),
  spentType: z.string().min(1).max(100),
  note: z.string().max(1000).optional().nullable(),
  module: z.enum(["GENERAL", "RUNNING"]).optional(),
  editNote: z.string().max(1000).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_EXPENSES");
  if ("error" in gate) return gate.error;

  const parsed = PatchBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid data" },
      { status: 400 },
    );
  }

  const { id } = await params;
  const { editNote, ...input } = parsed.data;
  const result = await updateExpense(id, input, editNote);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_EXPENSES");
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const result = await deleteExpense(id);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
