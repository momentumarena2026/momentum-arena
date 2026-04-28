import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { adminAuth } from "@/lib/admin-auth-session";
import { SignOutButton } from "@/components/sign-out-button";
import { hasPermission } from "@/lib/permissions";
import { AdminSidebar } from "./admin-sidebar";

// All nav items with permission requirements (no icon references — those live in the client component)
const allNavItems = [
  { href: "/admin", label: "Overview", group: "General", permission: null },
  { href: "/admin/analytics", label: "Analytics", group: "General", permission: "VIEW_ANALYTICS" },
  { href: "/admin/bookings", label: "All Bookings", group: "Bookings", permission: "MANAGE_BOOKINGS" },
  { href: "/admin/bookings/unconfirmed", label: "Unconfirmed", group: "Bookings", permission: "MANAGE_BOOKINGS" },
  { href: "/admin/bookings/calendar", label: "Calendar", group: "Bookings", permission: "MANAGE_BOOKINGS" },
  { href: "/admin/checkin", label: "Check-in", group: "Bookings", permission: "MANAGE_BOOKINGS" },
  { href: "/admin/recurring", label: "Recurring", group: "Bookings", permission: "MANAGE_PRICING" },
  { href: "/admin/sports", label: "Sports", group: "Courts & Pricing", permission: "MANAGE_SPORTS" },
  { href: "/admin/equipment", label: "Equipment", group: "Courts & Pricing", permission: "MANAGE_SPORTS" },
  { href: "/admin/pricing", label: "Pricing", group: "Courts & Pricing", permission: "MANAGE_PRICING" },
  { href: "/admin/slots", label: "Slot Blocks", group: "Courts & Pricing", permission: "MANAGE_SLOTS" },
  { href: "/admin/cafe-menu", label: "Menu", group: "Cafe", permission: "MANAGE_CAFE_MENU" },
  { href: "/admin/cafe-orders", label: "Orders", group: "Cafe", permission: "MANAGE_CAFE_ORDERS" },
  { href: "/admin/cafe-live", label: "Live Orders", group: "Cafe", permission: "MANAGE_CAFE_ORDERS" },
  { href: "/admin/coupons", label: "Coupons", group: "Promotions", permission: "MANAGE_COUPONS" },
  { href: "/admin/rewards", label: "Rewards", group: "Promotions", permission: "MANAGE_REWARDS" },
  { href: "/admin/expenses", label: "Expenses", group: "Operations", permission: "MANAGE_EXPENSES" },
  { href: "/admin/expenses/analytics", label: "Expense Analytics", group: "Operations", permission: "MANAGE_EXPENSES" },
  { href: "/admin/push", label: "Push Notifications", group: "Operations", permission: "MANAGE_PUSH" },
  { href: "/admin/users", label: "Users", group: "Settings", permission: "MANAGE_USERS" },
  { href: "/admin/admin-users", label: "Admin Users", group: "Settings", permission: "MANAGE_ADMIN_USERS" },
  { href: "/admin/generator", label: "Generator", group: "Settings", permission: "MANAGE_PRICING" },
  { href: "/admin/faqs", label: "FAQs", group: "Settings", permission: "MANAGE_FAQS" },
  { href: "/admin/payment-settings", label: "Payment Gateway", group: "Settings", permission: "VIEW_RAZORPAY" },
  { href: "/admin/razorpay", label: "Razorpay", group: "Settings", permission: "VIEW_RAZORPAY" },
];

const GROUP_ORDER = ["General", "Bookings", "Courts & Pricing", "Cafe", "Promotions", "Operations", "Settings"];

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

  const staffAllowedHrefs = ["/admin", "/admin/bookings", "/admin/bookings/unconfirmed", "/admin/bookings/calendar", "/admin/checkin", "/admin/cafe-live"];

  // Filter items by permissions and build serializable groups
  const visibleItems = allNavItems.filter((item) => {
    if (isStaff) return staffAllowedHrefs.includes(item.href);
    if (!item.permission) return true;
    if (isSuperadmin) return true;
    return hasPermission(userPermissions, item.permission);
  });

  // Group them
  const groups: { label: string; items: { href: string; label: string }[] }[] = [];
  for (const groupName of GROUP_ORDER) {
    const items = visibleItems
      .filter((i) => i.group === groupName)
      .map(({ href, label }) => ({ href, label }));
    if (items.length > 0) {
      groups.push({ label: groupName, items });
    }
  }

  const roleBadge = isSuperadmin
    ? { label: "Superadmin", cls: "bg-red-600/20 text-red-400 border-red-600/30" }
    : isStaff
    ? { label: "Staff", cls: "bg-blue-600/20 text-blue-400 border-blue-600/30" }
    : { label: "Admin", cls: "bg-amber-600/20 text-amber-400 border-amber-600/30" };

  return (
    <div className="min-h-screen bg-black">
      {/* Top bar — mobile only */}
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
          groups={groups}
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
