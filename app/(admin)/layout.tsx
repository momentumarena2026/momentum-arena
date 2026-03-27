import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { auth } from "@/lib/auth";
import { SignOutButton } from "@/components/sign-out-button";
import { hasPermission } from "@/lib/permissions";
import {
  LayoutDashboard,
  CalendarCheck,
  IndianRupee,
  CalendarOff,
  Dumbbell,
  Users,
  Ticket,
  Megaphone,
  HelpCircle,
  Shield,
  CreditCard,
  Coffee,
  ClipboardList,
  BadgePercent,
  BarChart3,
  CalendarDays,
  Activity,
  Gift,
  Tags,
} from "lucide-react";

const adminNavItems = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, permission: null },
  { href: "/admin/bookings", label: "Bookings", icon: CalendarCheck, permission: "MANAGE_BOOKINGS" },
  { href: "/admin/pricing", label: "Pricing", icon: IndianRupee, permission: "MANAGE_PRICING" },
  { href: "/admin/slots", label: "Slot Blocks", icon: CalendarOff, permission: "MANAGE_SLOTS" },
  { href: "/admin/sports", label: "Sports", icon: Dumbbell, permission: "MANAGE_SPORTS" },
  { href: "/admin/users", label: "Users", icon: Users, permission: "MANAGE_USERS" },
  { href: "/admin/banners", label: "Banners", icon: Megaphone, permission: "MANAGE_BANNERS" },
  { href: "/admin/faqs", label: "FAQs", icon: HelpCircle, permission: "MANAGE_FAQS" },
  { href: "/admin/razorpay", label: "Razorpay", icon: CreditCard, permission: "VIEW_RAZORPAY" },
  { href: "/admin/admin-users", label: "Admin Users", icon: Shield, permission: "MANAGE_ADMIN_USERS" },
  { href: "/admin/cafe-menu", label: "Cafe Menu", icon: Coffee, permission: "MANAGE_CAFE_MENU" },
  { href: "/admin/cafe-orders", label: "Cafe Orders", icon: ClipboardList, permission: "MANAGE_CAFE_ORDERS" },
  { href: "/admin/cafe-live", label: "Live Orders", icon: Activity, permission: "MANAGE_CAFE_ORDERS" },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3, permission: "VIEW_ANALYTICS" },
  { href: "/admin/calendar", label: "Calendar", icon: CalendarDays, permission: "MANAGE_BOOKINGS" },
  { href: "/admin/rewards", label: "Rewards", icon: Gift, permission: "MANAGE_REWARDS" },
  { href: "/admin/coupons", label: "Coupons", icon: Tags, permission: "MANAGE_COUPONS" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/godmode");
  if (session.user.userType !== "admin") redirect("/godmode");

  const userPermissions = session.user.permissions || [];
  const isSuperadmin = session.user.adminRole === "SUPERADMIN";

  // Filter nav items based on permissions
  const visibleNavItems = adminNavItems.filter((item) => {
    if (!item.permission) return true; // Overview always visible
    if (isSuperadmin) return true; // Superadmin sees everything
    return hasPermission(userPermissions, item.permission);
  });

  return (
    <div className="min-h-screen bg-black">
      <nav className="border-b border-zinc-800 bg-zinc-950">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-6">
              <Link href="/">
                <Image
                  src="/blackLogo.png"
                  alt="Momentum Arena"
                  width={240}
                  height={80}
                  className="h-24 w-auto"
                />
              </Link>
              <span className="rounded-md bg-red-600/20 px-2 py-1 text-xs font-medium text-red-400 border border-red-600/30">
                {isSuperadmin ? "Superadmin" : "Admin"}
              </span>
            </div>

            <div className="flex items-center gap-4">
              <Link
                href="/admin/profile"
                className="text-sm text-zinc-400 hover:text-white transition-colors"
              >
                {session.user.name || session.user.email}
              </Link>
              <SignOutButton redirectTo="/godmode" />
            </div>
          </div>
        </div>
      </nav>

      {/* Admin Sub-nav */}
      <div className="border-b border-zinc-800 bg-zinc-950/50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex gap-1 overflow-x-auto py-2">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors whitespace-nowrap"
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
