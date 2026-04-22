import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listActiveExpenseOptionsByField } from "@/actions/admin-expenses";
import { ExpenseForm } from "../expense-form";

function todayISO(): string {
  // Use the server's current UTC date. The DATE column stores a
  // calendar day only so TZ drift is fine.
  return new Date().toISOString().slice(0, 10);
}

export default async function NewExpensePage() {
  const options = await listActiveExpenseOptionsByField();

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
        <h1 className="mt-2 text-2xl font-bold text-white">New Expense</h1>
        <p className="mt-1 text-zinc-400">
          Record a new cost entry.
        </p>
      </div>

      <ExpenseForm
        mode="create"
        initial={{
          date: todayISO(),
          description: "",
          amount: 0,
          paymentType: "",
          doneBy: "",
          toName: "",
          vendor: "",
          spentType: "",
          note: "",
        }}
        options={options}
      />
    </div>
  );
}
