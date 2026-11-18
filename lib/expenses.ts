// Shared helpers used across the admin Expenses UI.

export function formatExpenseAmount(amountRupees: number): string {
  return `₹${amountRupees.toLocaleString("en-IN")}`;
}

export function formatExpenseDate(dateInput: Date | string): string {
  const d = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatExpenseDateShort(dateInput: Date | string): string {
  const d = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function toISODateOnly(dateInput: Date | string): string {
  const d = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return d.toISOString().slice(0, 10);
}

export const EXPENSE_OPTION_FIELD_LABELS = {
  PAYMENT_TYPE: "Payment Type",
  DONE_BY: "Done By",
  VENDOR: "Vendor",
  SPENT_TYPE: "Spent Type",
  TO_NAME: "To (Recipient)",
} as const;

export type ExpenseOptionFieldKey = keyof typeof EXPENSE_OPTION_FIELD_LABELS;

/**
 * Payer labels that mean "the venture paid this out of its own account",
 * as opposed to "a person fronted it and is owed the money back".
 *
 * This matters because the whole point of the contributions panel is the
 * figure the venture transfers TO somebody. A row paid by the venture
 * itself is already settled; listing it as reimbursable would invite a
 * transfer from the company to the company.
 *
 * It is a constant rather than a column on ExpenseOption because that
 * would be a schema change nobody asked for. The trade is that renaming
 * the dropdown option will stop it matching — so the panel labels this
 * group explicitly on screen, which makes a mismatch show up as the
 * venture appearing among the people rather than as a quietly wrong
 * total. Add the new spelling here if that happens.
 */
const VENTURE_PAYER_LABELS = new Set([
  "sportive ventures",
  "sportive venture",
]);

export function isVenturePayer(doneBy: string): boolean {
  return VENTURE_PAYER_LABELS.has(doneBy.trim().toLowerCase());
}
