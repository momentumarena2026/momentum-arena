import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { adminAuth } from "@/lib/admin-auth-session";
import { SignOutButton } from "@/components/sign-out-button";
import { hasPermission } from "@/lib/permissions";
import { AdminSidebar } from "./admin-sidebar";
import {
  LayoutDashboard,
  CalendarCheck,
  IndianRupee,
  CalendarOff,
  Dumbbell,
  Users,
  Megaphone,
  HelpCircle,
  Shield,
  CreditCard,
  Coffee,
  ClipboardList,
  BarChart3,
  CalendarDays,
  Activity,
  Gift,
  Tags,
  ScanLine,
  Package,
} from "lucide-react";

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission: string | null;
}

const adminNavGroups: NavGroup[] = [
  {
    label: "General",
    items: [
      { href: "/admin", label: "Overview", icon: LayoutDashboard, permission: null },
      { href: "/admin/analytics", label: "Analytics", icon: BarChart3, permission: "VIEW_ANALYTICS" },
    ],
  },
  {
    label: "Bookings",
    items: [
      { href: "/admin/bookings", label: "Bookings", icon: CalendarCheck, permission: "MANAGE_BOOKINGS" },
      { href: "/admin/checkin", label: "Check-in", icon: ScanLine, permission: "MANAGE_BOOKINGS" },
      { href: "/admin/utr-verify", label: "UTR Verify", icon: ScanLine, permission: "MANAGE_BOOKINGS" },
      { href: "/admin/recurring", label: "Recurring", icon: CalendarDays, permission: "MANAGE_PRICING" },
    ],
  },
  {
    label: "Courts & Pricing",
    items: [
      { href: "/admin/sports", label: "Sports", icon: Dumbbell, permission: "MANAGE_SPORTS" },
      { href: "/admin/equipment", label: "Equipment", icon: Package, permission: "MANAGE_SPORTS" },
      { href: "/admin/pricing", label: "Pricing", icon: IndianRupee, permission: "MANAGE_PRICING" },
      { href: "/admin/slots", label: "Slot Blocks", icon: CalendarOff, permission: "MANAGE_SLOTS" },
    ],
  },
  {
    label: "Cafe",
    items: [
      { href: "/admin/cafe-menu", label: "Menu", icon: Coffee, permission: "MANAGE_CAFE_MENU" },
      { href: "/admin/cafe-orders", label: "Orders", icon: ClipboardList, permission: "MANAGE_CAFE_ORDERS" },
      { href: "/admin/cafe-live", label: "Live Orders", icon: Activity, permission: "MANAGE_CAFE_ORDERS" },
    ],
  },
  {
    label: "Promotions",
    items: [
      { href: "/admin/coupons", label: "Coupons", icon: Tags, permission: "MANAGE_COUPONS" },
      { href: "/admin/banners", label: "Banners", icon: Megaphone, permission: "MANAGE_BANNERS" },
      { href: "/admin/rewards", label: "Rewards", icon: Gift, permission: "MANAGE_REWARDS" },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/admin/users", label: "Users", icon: Users, permission: "MANAGE_USERS" },
      { href: "/admin/admin-users", label: "Admin Users", icon: Shield, permission: "MANAGE_ADMIN_USERS" },
      { href: "/admin/faqs", label: "FAQs", icon: HelpCircle, permission: "MANAGE_FAQS" },
      { href: "/admin/razorpay", label: "Razorpay", icon: CreditCard, permission: "VIEW_RAZORPAY" },
    ],
  },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await adminAuth();
  if (!session?.user) redirect("/godmode");

  const user = session.user as unknown as {
    id: string;
    name?: string;
    adminRole?: string;
    permissions?: string[];
  };

  const userPermissions = user.permissions || [];
  const isSuperadmin = user.adminRole === "SUPERADMIN";
  const isStaff = user.adminRole === "STAFF";

  // Staff only see a restricted set of nav items
  const staffAllowedHrefs = ["/admin", "/admin/bookings", "/admin/checkin", "/admin/cafe-live"];

  // Filter nav groups based on permissions
  const visibleGroups: NavGroup[] = adminNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (isStaff) return staffAllowedHrefs.includes(item.href);
        if (!item.permission) return true;
        if (isSuperadmin) return true;
        return hasPermission(userPermissions, item.permission);
      }),
    }))
    .filter((group) => group.items.length > 0);

  const roleBadge = isSuperadmin
    ? { label: "Superadmin", cls: "bg-red-600/20 text-red-400 border-red-600/30" }
    : isStaff
    ? { label: "Staff", cls: "bg-blue-600/20 text-blue-400 border-blue-600/30" }
    : { label: "Admin", cls: "bg-amber-600/20 text-amber-400 border-amber-600/30" };

  return (
    <div className="min-h-screen bg-black">
      {/* Top bar — mobile only shows hamburger, desktop shows minimal header */}
      <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950 lg:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <Link href="/admin">
            <Image
              src="/blackLogo.png"
              alt="Momentum Arena"
              width={160}
              height={53}
              className="h-14 w-auto"
            />
          </Link>
          <div className="flex items-center gap-3">
            <span className={`rounded-md px-2 py-0.5 text-[10px] font-medium border ${roleBadge.cls}`}>
              {roleBadge.label}
            </span>
            <SignOutButton isAdmin redirectTo="/godmode" />
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <AdminSidebar
          groups={visibleGroups}
          userName={session.user.name || session.user.email || "Admin"}
          roleBadge={roleBadge}
        />

        {/* Main content */}
        <main className="flex-1 min-w-0 lg:ml-64">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
