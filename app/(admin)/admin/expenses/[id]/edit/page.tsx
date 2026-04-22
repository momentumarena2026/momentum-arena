import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, History } from "lucide-react";
import {
  getExpenseById,
  listActiveExpenseOptionsByField,
} from "@/actions/admin-expenses";
import { ExpenseForm } from "../../expense-form";
import { ExpenseEditHistory } from "../../expense-edit-history";
import { toISODateOnly } from "@/lib/expenses";

export default async function EditExpensePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [expense, options] = await Promise.all([
    getExpenseById(id),
    listActiveExpenseOptionsByField(),
  ]);
  if (!expense) notFound();

  type ChangeEntry = {
    field: string;
    from: string | number | null;
    to: string | number | null;
  };

  const historyForClient = expense.editHistory.map((h) => ({
    id: h.id,
    adminUsername: h.adminUsername,
    editType: h.editType,
    // Prisma JSON column types as unknown here; we cast to the shape the
    // writer uses. The column is fully controlled by our server actions
    // and the CSV importer, so this is safe.
    changes: (h.changes as unknown as ChangeEntry[]) || [],
    note: h.note,
    createdAt: h.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/expenses"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to expenses
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-white">Edit Expense</h1>
        <p className="mt-1 text-zinc-400">
          Changes are logged in the edit history below.
        </p>
      </div>

      <ExpenseForm
        mode="edit"
        expenseId={expense.id}
        initial={{
          date: toISODateOnly(expense.date),
          description: expense.description,
          amount: expense.amount,
          paymentType: expense.paymentType,
          doneBy: expense.doneBy,
          toName: expense.toName,
          vendor: expense.vendor,
          spentType: expense.spentType,
          note: expense.note || "",
        }}
        options={options}
      />

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="flex items-center gap-2 text-lg font-semibold text-white mb-4">
          <History className="h-5 w-5 text-zinc-400" />
          Edit History
        </div>
        <ExpenseEditHistory history={historyForClient} />
      </div>
    </div>
  );
}
