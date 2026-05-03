import { AnalyticsTabs } from "./analytics-tabs";

/**
 * Wraps every /admin/analytics/* page with a tab strip:
 *
 *   Revenue (default)  —  the existing earnings/KPI dashboard
 *   Funnels            —  per-funnel step counts + drop-off
 *   Events             —  raw event log + filters
 *   Cohorts            —  week-on-week retention grid
 *   Demand             —  unmet-demand heatmap (waitlist + taps)
 *
 * The Revenue tab is the existing page (no rename needed) so deep
 * links into /admin/analytics keep working. New tabs live under
 * sibling routes.
 */
export default function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <AnalyticsTabs />
      {children}
    </div>
  );
}
