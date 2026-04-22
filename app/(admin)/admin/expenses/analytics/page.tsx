import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getExpenseAnalytics } from "@/actions/admin-expenses";
import { ExpenseAnalyticsClient } from "./expense-analytics-client";

export default async function ExpenseAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const data = await getExpenseAnalytics({
    from: params.from,
    to: params.to,
  });

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
        <h1 className="mt-2 text-2xl font-bold text-white">
          Expense Analytics
        </h1>
        <p className="mt-1 text-zinc-400">
          Spending breakdown across categories, people, and payment rails.
        </p>
      </div>

      <ExpenseAnalyticsClient
        initialFrom={params.from || ""}
        initialTo={params.to || ""}
        data={data}
      />
    </div>
  );
}
