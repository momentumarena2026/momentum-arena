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
