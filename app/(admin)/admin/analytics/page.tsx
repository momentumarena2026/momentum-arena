import { redirect } from "next/navigation";

/**
 * Bare /admin/analytics URL — redirects to the sports analytics
 * dashboard, which is the historical default. Cafe analytics live
 * at /admin/analytics/cafe.
 */
export default function AnalyticsIndexPage() {
  redirect("/admin/analytics/sports");
}
