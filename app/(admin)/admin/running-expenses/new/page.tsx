import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listActiveExpenseOptionsByField } from "@/actions/admin-expenses";
import { ExpenseForm } from "../../expenses/expense-form";

function todayISO(): string {
  // Use the server's current UTC date. The DATE column stores a
  // calendar day only so TZ drift is fine.
  return new Date().toISOString().slice(0, 10);
}

export default async function NewRunningExpensePage() {
  const options = await listActiveExpenseOptionsByField(undefined, "RUNNING");

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/running-expenses"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to running expenses
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-white">
          New Running Expense
        </h1>
        <p className="mt-1 text-zinc-400">
          Record a new cost entry.
        </p>
      </div>

      <ExpenseForm
        mode="create"
        module="RUNNING"
        basePath="/admin/running-expenses"
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
