"use client";

/**
 * Tab wrapper for the /admin/coupons page. Two surfaces share this
 * route because they're tightly coupled — every reason to look at
 * groups is to wire them onto a coupon, so a single page with two
 * tabs reads better than two siblings in the admin nav.
 *
 * Tab state lives in the URL (?tab=groups) so a deep link from
 * elsewhere — e.g. a user-detail page that says "this user belongs
 * to 3 groups, manage them here" — can land directly on the right
 * tab.
 */

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Tag, Users } from "lucide-react";
import { CouponsManager, type CouponRow, type GroupOption } from "./coupons-manager";
import {
  UserGroupsManager,
  type UserGroupRow,
} from "./user-groups-manager";

interface Props {
  coupons: CouponRow[];
  groups: UserGroupRow[];
  groupOptions: GroupOption[];
}

export function CouponsTabs({ coupons, groups, groupOptions }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") === "groups" ? "groups" : "coupons";

  const setTab = (tab: "coupons" | "groups") => {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "coupons") params.delete("tab");
    else params.set("tab", tab);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 border-b border-zinc-800">
        <TabButton
          active={activeTab === "coupons"}
          onClick={() => setTab("coupons")}
          icon={<Tag className="h-4 w-4" />}
          label="Coupons"
          count={coupons.length}
        />
        <TabButton
          active={activeTab === "groups"}
          onClick={() => setTab("groups")}
          icon={<Users className="h-4 w-4" />}
          label="User Groups"
          count={groups.length}
        />
      </div>

      {activeTab === "coupons" ? (
        <CouponsManager coupons={coupons} groupOptions={groupOptions} />
      ) : (
        <UserGroupsManager groups={groups} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
        active
          ? "border-emerald-500 text-emerald-400"
          : "border-transparent text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {icon}
      {label}
      <span
        className={`rounded-full px-2 text-[10px] font-semibold ${
          active
            ? "bg-emerald-500/20 text-emerald-300"
            : "bg-zinc-800 text-zinc-400"
        }`}
      >
        {count}
      </span>
    </button>
  );
}
