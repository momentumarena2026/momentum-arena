import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, History, Lock } from "lucide-react";
import { getExpenseById } from "@/actions/admin-expenses";
import { ExpenseEditHistory } from "../../expense-edit-history";
import { toISODateOnly } from "@/lib/expenses";
import { formatPrice } from "@/lib/pricing";

/**
 * READ-ONLY detail view (2026-07-03, user policy): the original Expenses
 * tab accepts no edits or deletes — this page shows the record + its audit
 * history. The route keeps the /edit path so old links keep working; the
 * server actions reject GENERAL mutations regardless. New spend is
 * recorded under Running Expenses.
 */
export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const expense = await getExpenseById(id);
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

  const fields: { label: string; value: string }[] = [
    { label: "Date", value: toISODateOnly(expense.date) },
    { label: "Description", value: expense.description },
    { label: "Amount", value: formatPrice(expense.amount) },
    { label: "Payment Type", value: expense.paymentType },
    { label: "Done By", value: expense.doneBy },
    { label: "To (Recipient)", value: expense.toName },
    { label: "Vendor", value: expense.vendor || "—" },
    { label: "Spent Type", value: expense.spentType },
    { label: "Note", value: expense.note || "—" },
  ];

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
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-white">Expense</h1>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300">
            <Lock className="h-3.5 w-3.5" />
            Read-only
          </span>
        </div>
        <p className="mt-1 text-zinc-400">
          Historical record — editing is disabled. New entries go to Running
          Expenses.
        </p>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.label}>
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {f.label}
              </dt>
              <dd className="mt-1 text-sm text-zinc-200">{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>

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
