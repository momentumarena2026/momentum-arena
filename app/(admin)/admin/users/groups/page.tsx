import Link from "next/link";
import { listUserGroups } from "@/actions/admin-user-groups";
import { UserGroupsManager } from "./user-groups-manager";

/**
 * Settings → Users → User Groups.
 *
 * This is now the single home for user-group CRUD. The same DB model
 * (`UserGroup` + `UserGroupMember`) is consumed by every feature that
 * targets groups today:
 *
 *   - Coupons   (`CouponEligibleGroup` on /admin/coupons)
 *   - Push       (`getActiveUserGroupsForPush` on /admin/push)
 *   - Future:   rewards adjustments, segment-specific notifications, etc.
 *
 * Previously the manager lived inside /admin/coupons as a tab; it was
 * never coupon-specific data, just convenient to mount it there. Moving
 * it under /admin/users makes the discovery story honest — groups ARE
 * a user-management primitive that other features inherit from, not a
 * coupons sub-concept.
 */
export default async function AdminUserGroupsPage() {
  const groups = await listUserGroups();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">User Groups</h1>
        <p className="mt-1 text-zinc-400">
          Custom cohorts of customers. Any feature that targets a group —
          coupons, push notifications, future segment-specific promos —
          reads from this list.
        </p>
      </div>

      {/* Cross-link to the surfaces that consume these groups. Makes the
          "this is the source of truth" relationship visible to admins
          who land here via the sidebar rather than via a coupon. */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">
          Used by
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/coupons"
            className="rounded-full border border-zinc-700 bg-zinc-800/60 px-3 py-1 text-xs font-medium text-zinc-200 hover:border-emerald-500/40 hover:text-emerald-300 transition-colors"
          >
            Coupons →
          </Link>
          <Link
            href="/admin/push"
            className="rounded-full border border-zinc-700 bg-zinc-800/60 px-3 py-1 text-xs font-medium text-zinc-200 hover:border-emerald-500/40 hover:text-emerald-300 transition-colors"
          >
            Push Notifications →
          </Link>
        </div>
      </div>

      <UserGroupsManager groups={groups} />
    </div>
  );
}
