import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listExpenseOptions } from "@/actions/admin-expenses";
import { EXPENSE_OPTION_FIELD_LABELS, type ExpenseOptionFieldKey } from "@/lib/expenses";
import { ExpenseConfigClient } from "./expense-config-client";

export default async function ExpenseConfigPage() {
  const options = await listExpenseOptions();

  // Group by field for the client component so it can render one tab
  // per dropdown without re-fetching.
  const grouped: Record<
    ExpenseOptionFieldKey,
    {
      id: string;
      field: ExpenseOptionFieldKey;
      label: string;
      isActive: boolean;
      sortOrder: number;
    }[]
  > = {
    PAYMENT_TYPE: [],
    DONE_BY: [],
    VENDOR: [],
    SPENT_TYPE: [],
    TO_NAME: [],
  };
  for (const o of options) {
    grouped[o.field as ExpenseOptionFieldKey].push({
      id: o.id,
      field: o.field as ExpenseOptionFieldKey,
      label: o.label,
      isActive: o.isActive,
      sortOrder: o.sortOrder,
    });
  }

  const fieldTabs = (
    Object.keys(EXPENSE_OPTION_FIELD_LABELS) as ExpenseOptionFieldKey[]
  ).map((field) => ({
    field,
    label: EXPENSE_OPTION_FIELD_LABELS[field],
    count: grouped[field].length,
    activeCount: grouped[field].filter((o) => o.isActive).length,
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
        <h1 className="mt-2 text-2xl font-bold text-white">
          Dropdown Options
        </h1>
        <p className="mt-1 text-zinc-400">
          Add, rename, disable, or reorder the options that feed each
          expense field. Historical rows keep their original labels even if
          you rename or disable an option here.
        </p>
      </div>

      <ExpenseConfigClient grouped={grouped} fieldTabs={fieldTabs} />
    </div>
  );
}
