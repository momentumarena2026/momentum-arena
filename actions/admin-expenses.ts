"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Prisma, ExpenseOptionField } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";

/**
 * Admin Expenses — server actions.
 *
 * Every create / update writes an ExpenseEditHistory row so the UI has a
 * full audit trail. We store `changes` as a JSON array of { field, from,
 * to } triples rather than dedicated columns per field, since the expense
 * schema has many mutable fields and future additions would otherwise
 * require a migration.
 *
 * adminId + adminUsername are denormalized onto each history row so the
 * log stays readable if the AdminUser is deleted. Both are nullable for
 * CSV import / seed rows that have no actor.
 */

async function requireExpenseAdmin() {
  return await requireAdminBase("MANAGE_EXPENSES");
}

/**
 * Mobile admin routes pre-authenticate via JWT and pass `skipAuth`
 * (reads, delete) or `adminOverride: { id, name }` (create, update)
 * so the cookie-based gate doesn't fire and the audit trail still
 * records the mobile admin's identity.
 */

// ---------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------

// Amount accepts rupees as a positive integer. The UI binds a text input
// so we coerce + floor defensively.
const amountSchema = z
  .number()
  .int()
  .positive()
  .max(10_00_00_000); // ₹10cr hard cap — a typo guard, not a business rule

const expenseInputSchema = z.object({
  date: z.string().min(1), // YYYY-MM-DD
  description: z.string().min(1).max(500),
  amount: amountSchema,
  paymentType: z.string().min(1).max(100),
  doneBy: z.string().min(1).max(100),
  toName: z.string().min(1).max(200),
  vendor: z.string().min(1).max(100),
  spentType: z.string().min(1).max(100),
  note: z.string().max(1000).optional().nullable(),
});

export type ExpenseInput = z.infer<typeof expenseInputSchema>;

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

type ExpenseRow = Awaited<ReturnType<typeof db.expense.findUniqueOrThrow>>;

type ChangeEntry = {
  field: string;
  from: string | number | null;
  to: string | number | null;
};

const TRACKED_FIELDS: (keyof ExpenseRow)[] = [
  "date",
  "description",
  "amount",
  "paymentType",
  "doneBy",
  "toName",
  "vendor",
  "spentType",
  "note",
];

function toComparable(value: unknown): string | number | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return value;
  return String(value);
}

function diffExpense(
  previous: ExpenseRow,
  next: Partial<ExpenseRow>
): ChangeEntry[] {
  const changes: ChangeEntry[] = [];
  for (const key of TRACKED_FIELDS) {
    if (!(key in next)) continue;
    const from = toComparable(previous[key]);
    const to = toComparable(next[key] as unknown);
    if (from !== to) {
      changes.push({ field: key, from, to });
    }
  }
  return changes;
}

function parseDateOnly(yyyyMmDd: string): Date {
  // Treat the string as UTC midnight so the DATE column stores the
  // intended calendar day regardless of server TZ. Postgres DATE has no
  // time component so this is safe.
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(yyyyMmDd.trim());
  if (!match) throw new Error(`Invalid date: ${yyyyMmDd}`);
  const [, y, m, d] = match;
  return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
}

// ---------------------------------------------------------------------
// List + fetch
// ---------------------------------------------------------------------

export interface ListExpensesFilters {
  from?: string;
  to?: string;
  spentType?: string;
  doneBy?: string;
  paymentType?: string;
  vendor?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export async function listExpenses(
  filters: ListExpensesFilters = {},
  skipAuth?: boolean,
) {
  if (!skipAuth) await requireExpenseAdmin();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, filters.pageSize ?? 50));
  const skip = (page - 1) * pageSize;

  const where: Prisma.ExpenseWhereInput = {};
  if (filters.from || filters.to) {
    where.date = {};
    if (filters.from) (where.date as Prisma.DateTimeFilter).gte = parseDateOnly(filters.from);
    if (filters.to) (where.date as Prisma.DateTimeFilter).lte = parseDateOnly(filters.to);
  }
  if (filters.spentType) where.spentType = filters.spentType;
  if (filters.doneBy) where.doneBy = filters.doneBy;
  if (filters.paymentType) where.paymentType = filters.paymentType;
  if (filters.vendor) where.vendor = filters.vendor;
  if (filters.search) {
    where.OR = [
      { description: { contains: filters.search, mode: "insensitive" } },
      { toName: { contains: filters.search, mode: "insensitive" } },
      { note: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  const [rows, total, totalAmountAgg] = await Promise.all([
    db.expense.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip,
      take: pageSize,
    }),
    db.expense.count({ where }),
    db.expense.aggregate({ where, _sum: { amount: true } }),
  ]);

  return {
    rows,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    totalAmount: totalAmountAgg._sum.amount ?? 0,
  };
}

export async function getExpenseById(id: string, skipAuth?: boolean) {
  if (!skipAuth) await requireExpenseAdmin();
  const expense = await db.expense.findUnique({
    where: { id },
    include: {
      editHistory: { orderBy: { createdAt: "desc" } },
    },
  });
  return expense;
}

// ---------------------------------------------------------------------
// Create + update + delete
// ---------------------------------------------------------------------

export async function createExpense(
  input: ExpenseInput,
  adminOverride?: { id: string; name: string },
) {
  const admin = adminOverride ?? (await requireExpenseAdmin());

  const parsed = expenseInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false as const,
      error: parsed.error.issues[0]?.message || "Invalid data",
    };
  }
  const data = parsed.data;

  try {
    const created = await db.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          date: parseDateOnly(data.date),
          description: data.description.trim(),
          amount: Math.floor(data.amount),
          paymentType: data.paymentType.trim(),
          doneBy: data.doneBy.trim(),
          toName: data.toName.trim(),
          vendor: data.vendor.trim(),
          spentType: data.spentType.trim(),
          note: data.note?.trim() || null,
          createdByAdminId: admin.id,
        },
      });

      await tx.expenseEditHistory.create({
        data: {
          expenseId: expense.id,
          adminId: admin.id,
          adminUsername:
            admin.name ||
            ("email" in admin ? admin.email : undefined) ||
            "admin",
          editType: "CREATED",
          changes: [] as unknown as Prisma.InputJsonValue,
        },
      });

      return expense;
    });

    revalidatePath("/admin/expenses");
    revalidatePath("/admin/expenses/analytics");
    return { success: true as const, id: created.id };
  } catch (error) {
    console.error("Failed to create expense:", error);
    return { success: false as const, error: "Failed to create expense" };
  }
}

export async function updateExpense(
  id: string,
  input: ExpenseInput,
  note?: string,
  adminOverride?: { id: string; name: string },
) {
  const admin = adminOverride ?? (await requireExpenseAdmin());

  const parsed = expenseInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false as const,
      error: parsed.error.issues[0]?.message || "Invalid data",
    };
  }
  const data = parsed.data;

  try {
    await db.$transaction(async (tx) => {
      const existing = await tx.expense.findUnique({ where: { id } });
      if (!existing) throw new Error("Expense not found");

      const proposed: Partial<ExpenseRow> = {
        date: parseDateOnly(data.date),
        description: data.description.trim(),
        amount: Math.floor(data.amount),
        paymentType: data.paymentType.trim(),
        doneBy: data.doneBy.trim(),
        toName: data.toName.trim(),
        vendor: data.vendor.trim(),
        spentType: data.spentType.trim(),
        note: data.note?.trim() || null,
      };

      const changes = diffExpense(existing, proposed);
      if (changes.length === 0) {
        // No-op edits still get a log entry only if an explicit note is
        // attached (e.g. admin documenting context without changing
        // data). Otherwise return silently.
        if (note && note.trim().length > 0) {
          await tx.expenseEditHistory.create({
            data: {
              expenseId: id,
              adminId: admin.id,
              adminUsername:
            admin.name ||
            ("email" in admin ? admin.email : undefined) ||
            "admin",
              editType: "UPDATED",
              changes: [] as unknown as Prisma.InputJsonValue,
              note: note.trim(),
            },
          });
        }
        return;
      }

      await tx.expense.update({ where: { id }, data: proposed });

      await tx.expenseEditHistory.create({
        data: {
          expenseId: id,
          adminId: admin.id,
          adminUsername:
            admin.name ||
            ("email" in admin ? admin.email : undefined) ||
            "admin",
          editType: "UPDATED",
          changes: changes as unknown as Prisma.InputJsonValue,
          note: note?.trim() || null,
        },
      });
    });

    revalidatePath("/admin/expenses");
    revalidatePath(`/admin/expenses/${id}/edit`);
    revalidatePath("/admin/expenses/analytics");
    return { success: true as const };
  } catch (error) {
    console.error("Failed to update expense:", error);
    return { success: false as const, error: "Failed to update expense" };
  }
}

export async function deleteExpense(id: string, skipAuth?: boolean) {
  if (!skipAuth) await requireExpenseAdmin();
  try {
    // Cascade-deletes the ExpenseEditHistory rows via the FK.
    await db.expense.delete({ where: { id } });
    revalidatePath("/admin/expenses");
    revalidatePath("/admin/expenses/analytics");
    return { success: true as const };
  } catch (error) {
    console.error("Failed to delete expense:", error);
    return { success: false as const, error: "Failed to delete expense" };
  }
}

// ---------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------

export interface AnalyticsFilters {
  from?: string;
  to?: string;
}

export async function getExpenseAnalytics(
  filters: AnalyticsFilters = {},
  skipAuth?: boolean,
) {
  if (!skipAuth) await requireExpenseAdmin();

  const where: Prisma.ExpenseWhereInput = {};
  if (filters.from || filters.to) {
    where.date = {};
    if (filters.from) (where.date as Prisma.DateTimeFilter).gte = parseDateOnly(filters.from);
    if (filters.to) (where.date as Prisma.DateTimeFilter).lte = parseDateOnly(filters.to);
  }

  const rows = await db.expense.findMany({
    where,
    select: {
      date: true,
      amount: true,
      spentType: true,
      doneBy: true,
      paymentType: true,
      vendor: true,
      toName: true,
    },
  });

  const totalAmount = rows.reduce((sum, r) => sum + r.amount, 0);
  const totalCount = rows.length;

  // Monthly series — keyed by YYYY-MM so it sorts lexicographically.
  const monthly = new Map<string, number>();
  for (const r of rows) {
    const key = r.date.toISOString().slice(0, 7);
    monthly.set(key, (monthly.get(key) || 0) + r.amount);
  }

  const monthlySeries = Array.from(monthly.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, amount]) => ({ month, amount }));

  // Category / dimension breakdowns — counts + sums, sorted desc by sum.
  function group<K extends keyof typeof rows[number]>(
    field: K
  ): { label: string; amount: number; count: number }[] {
    const map = new Map<string, { amount: number; count: number }>();
    for (const r of rows) {
      const label = String(r[field] ?? "—");
      const prev = map.get(label) || { amount: 0, count: 0 };
      prev.amount += r.amount;
      prev.count += 1;
      map.set(label, prev);
    }
    return Array.from(map.entries())
      .map(([label, v]) => ({ label, amount: v.amount, count: v.count }))
      .sort((a, b) => b.amount - a.amount);
  }

  const bySpentType = group("spentType");
  const byDoneBy = group("doneBy");
  const byPaymentType = group("paymentType");
  const byVendor = group("vendor");
  const byToName = group("toName").slice(0, 15); // top 15 recipients

  return {
    totalAmount,
    totalCount,
    monthlySeries,
    bySpentType,
    byDoneBy,
    byPaymentType,
    byVendor,
    byToName,
  };
}

// ---------------------------------------------------------------------
// Options / dropdown config
// ---------------------------------------------------------------------

export async function listExpenseOptions() {
  await requireExpenseAdmin();
  const rows = await db.expenseOption.findMany({
    orderBy: [{ field: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
  });
  return rows;
}

export async function listActiveExpenseOptionsByField(skipAuth?: boolean) {
  if (!skipAuth) await requireExpenseAdmin();
  const rows = await db.expenseOption.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
  const grouped: Record<ExpenseOptionField, string[]> = {
    PAYMENT_TYPE: [],
    DONE_BY: [],
    VENDOR: [],
    SPENT_TYPE: [],
    TO_NAME: [],
  };
  for (const r of rows) grouped[r.field].push(r.label);
  return grouped;
}

const optionInputSchema = z.object({
  field: z.enum(["PAYMENT_TYPE", "DONE_BY", "VENDOR", "SPENT_TYPE", "TO_NAME"]),
  label: z.string().min(1).max(100),
});

export async function createExpenseOption(input: {
  field: ExpenseOptionField;
  label: string;
}) {
  await requireExpenseAdmin();
  const parsed = optionInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false as const,
      error: parsed.error.issues[0]?.message || "Invalid data",
    };
  }

  const label = parsed.data.label.trim();
  try {
    // Compute next sortOrder for this field so new options append to the
    // bottom of the list.
    const last = await db.expenseOption.findFirst({
      where: { field: parsed.data.field },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    await db.expenseOption.create({
      data: {
        field: parsed.data.field,
        label,
        sortOrder: (last?.sortOrder ?? 0) + 10,
      },
    });
    return { success: true as const };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        success: false as const,
        error: `"${label}" already exists for this field`,
      };
    }
    console.error("Failed to create expense option:", error);
    return { success: false as const, error: "Failed to create option" };
  }
}

export async function updateExpenseOption(
  id: string,
  data: { label?: string; isActive?: boolean; sortOrder?: number }
) {
  await requireExpenseAdmin();
  try {
    await db.expenseOption.update({
      where: { id },
      data: {
        ...(data.label !== undefined ? { label: data.label.trim() } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      },
    });
    return { success: true as const };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        success: false as const,
        error: "Label already exists for this field",
      };
    }
    console.error("Failed to update expense option:", error);
    return { success: false as const, error: "Failed to update option" };
  }
}

export async function deleteExpenseOption(id: string) {
  await requireExpenseAdmin();
  try {
    await db.expenseOption.delete({ where: { id } });
    return { success: true as const };
  } catch (error) {
    console.error("Failed to delete expense option:", error);
    return { success: false as const, error: "Failed to delete option" };
  }
}

export async function reorderExpenseOptions(
  field: ExpenseOptionField,
  orderedIds: string[]
) {
  await requireExpenseAdmin();
  try {
    await db.$transaction(
      orderedIds.map((id, index) =>
        db.expenseOption.update({
          where: { id },
          data: { sortOrder: (index + 1) * 10 },
        })
      )
    );
    return { success: true as const };
  } catch (error) {
    console.error("Failed to reorder expense options:", error);
    return { success: false as const, error: "Failed to reorder" };
  }
}
