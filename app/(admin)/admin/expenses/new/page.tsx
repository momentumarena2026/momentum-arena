import { redirect } from "next/navigation";

/**
 * READ-ONLY (2026-07-03, user policy): the original Expenses tab accepts
 * no new entries — new spend is recorded under Running Expenses. This
 * route sticks around so old bookmarks don't 404; it just redirects.
 * createExpense rejects module GENERAL server-side regardless.
 */
export default function NewExpensePage() {
  redirect("/admin/expenses");
}
