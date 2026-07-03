import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getExpenseAnalytics } from "@/actions/admin-expenses";
import { ExpenseAnalyticsClient } from "../../expenses/analytics/expense-analytics-client";

export default async function RunningExpenseAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const data = await getExpenseAnalytics({
    module: "RUNNING",
    from: params.from,
    to: params.to,
  });

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
          Running Expense Analytics
        </h1>
        <p className="mt-1 text-zinc-400">
          Spending breakdown across categories, people, and payment rails.
        </p>
      </div>

      <ExpenseAnalyticsClient
        initialFrom={params.from || ""}
        initialTo={params.to || ""}
        data={data}
        basePath="/admin/running-expenses/analytics"
      />
    </div>
  );
}
