"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { AlertCircle, Save, Trash2 } from "lucide-react";
import {
  createExpense,
  updateExpense,
  deleteExpense,
  type ExpenseInput,
} from "@/actions/admin-expenses";

interface Options {
  PAYMENT_TYPE: string[];
  DONE_BY: string[];
  VENDOR: string[];
  SPENT_TYPE: string[];
  TO_NAME: string[];
}

interface Props {
  mode: "create" | "edit";
  expenseId?: string;
  initial: ExpenseInput;
  options: Options;
}

// Create + edit share one form. On save we route back to the list page
// (create) or stay on the edit page with router.refresh() so the edit
// history list below re-renders.
export function ExpenseForm({ mode, expenseId, initial, options }: Props) {
  const router = useRouter();
  // Plain loading flag instead of useTransition — when a server action is
  // followed by router.push(), wrapping both in a transition makes the
  // transition wait for the new route's RSC render to finish, which in
  // practice swallows the navigation on Next 16. Plain state dodges that.
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState<ExpenseInput>(initial);
  const [note, setNote] = useState(""); // only used for edit mode
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function setField<K extends keyof ExpenseInput>(key: K, value: ExpenseInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setPending(true);

    const payload: ExpenseInput = {
      ...form,
      amount: Number(form.amount),
      note: form.note?.trim() ? form.note : null,
    };

    try {
      if (mode === "create") {
        const res = await createExpense(payload);
        if (!res.success) {
          setError(res.error);
          return;
        }
        router.push("/admin/expenses");
        router.refresh();
      } else if (mode === "edit" && expenseId) {
        const res = await updateExpense(expenseId, payload, note);
        if (!res.success) {
          setError(res.error);
          return;
        }
        setSuccess("Saved");
        setNote("");
        router.refresh();
      }
    } catch (err) {
      console.error(err);
      setError("Unexpected error — check console and try again");
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    if (!expenseId) return;
    if (
      !confirm(
        "Delete this expense? This removes the row and its edit history permanently."
      )
    ) {
      return;
    }
    setPending(true);
    try {
      const res = await deleteExpense(expenseId);
      if (!res.success) {
        setError(res.error);
        return;
      }
      router.push("/admin/expenses");
      router.refresh();
    } catch (err) {
      console.error(err);
      setError("Unexpected error — check console and try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-5"
    >
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label="Date" required>
          <input
            type="date"
            required
            value={form.date}
            onChange={(e) => setField("date", e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Amount (₹)" required>
          <input
            type="number"
            required
            min={1}
            step={1}
            value={form.amount || ""}
            onChange={(e) => setField("amount", Number(e.target.value))}
            className={inputClass}
          />
        </Field>

        <Field label="Payment Type" required>
          <OptionSelect
            value={form.paymentType}
            onChange={(v) => setField("paymentType", v)}
            options={options.PAYMENT_TYPE}
          />
        </Field>
      </div>

      <Field label="Description" required>
        <input
          type="text"
          required
          value={form.description}
          onChange={(e) => setField("description", e.target.value)}
          className={inputClass}
          placeholder="e.g. Advance rent 1"
        />
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Spent Type" required>
          <OptionSelect
            value={form.spentType}
            onChange={(v) => setField("spentType", v)}
            options={options.SPENT_TYPE}
          />
        </Field>

        <Field label="Done By" required>
          <OptionSelect
            value={form.doneBy}
            onChange={(v) => setField("doneBy", v)}
            options={options.DONE_BY}
          />
        </Field>

        <Field label="To (Recipient)" required>
          <OptionSelect
            value={form.toName}
            onChange={(v) => setField("toName", v)}
            options={options.TO_NAME}
            allowCustom
          />
        </Field>

        <Field label="Vendor" required>
          <OptionSelect
            value={form.vendor}
            onChange={(v) => setField("vendor", v)}
            options={options.VENDOR}
          />
        </Field>
      </div>

      <Field label="Note (optional)">
        <textarea
          value={form.note || ""}
          onChange={(e) => setField("note", e.target.value)}
          rows={2}
          className={inputClass}
          placeholder="Any context worth keeping with this row"
        />
      </Field>

      {mode === "edit" && (
        <Field label="Edit note (optional — stored with this change)">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={inputClass}
            placeholder="Reason for the change"
          />
        </Field>
      )}

      <div className="flex items-center justify-between gap-3 pt-2">
        <div>
          {mode === "edit" && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/admin/expenses")}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {mode === "create" ? "Create Expense" : "Save Changes"}
          </button>
        </div>
      </div>
    </form>
  );
}

const inputClass =
  "w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-zinc-400">
        {label}
        {required ? <span className="text-red-400 ml-0.5">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function OptionSelect({
  value,
  onChange,
  options,
  allowCustom,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  allowCustom?: boolean;
}) {
  // Admins often need to add a new "To" (recipient) on the fly without
  // hopping to the config page. The `allowCustom` prop renders a free
  // text input with a datalist of existing options; for stricter
  // dropdowns (Spent Type, Done By, etc.) we keep it as a <select>.
  const listId = useId();

  if (allowCustom) {
    return (
      <>
        <input
          type="text"
          list={listId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
          required
        />
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      </>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required
      className={inputClass}
    >
      <option value="" disabled>
        Select…
      </option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
      {/* If the current value isn't in the active options (stale label
          after a rename / disable), keep it selectable so updates don't
          force-change it. */}
      {value && !options.includes(value) && (
        <option value={value}>{value} (inactive)</option>
      )}
    </select>
  );
}
