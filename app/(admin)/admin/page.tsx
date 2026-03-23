import { getAdminStats } from "@/actions/admin-booking";
import { formatPrice } from "@/lib/pricing";
import Link from "next/link";
import {
  CalendarCheck,
  Users,
  IndianRupee,
  CalendarDays,
  AlertCircle,
  ArrowRight,
} from "lucide-react";

export default async function AdminDashboardPage() {
  const stats = await getAdminStats();

  const statCards = [
    {
      label: "Total Bookings",
      value: stats.totalBookings.toString(),
      icon: CalendarCheck,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
    },
    {
      label: "Today's Bookings",
      value: stats.todayBookings.toString(),
      icon: CalendarDays,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
    },
    {
      label: "Revenue Today",
      value: formatPrice(stats.todayRevenue),
      icon: IndianRupee,
      color: "text-yellow-400",
      bg: "bg-yellow-500/10",
    },
    {
      label: "Active Users",
      value: stats.totalUsers.toString(),
      icon: Users,
      color: "text-purple-400",
      bg: "bg-purple-500/10",
    },
    {
      label: "Pending Payments",
      value: stats.pendingPayments.toString(),
      icon: AlertCircle,
      color: "text-orange-400",
      bg: "bg-orange-500/10",
    },
  ];

  const quickLinks = [
    { href: "/admin/bookings", label: "Manage Bookings", description: "View, confirm & refund" },
    { href: "/admin/pricing", label: "Set Pricing", description: "Peak/off-peak rates" },
    { href: "/admin/slots", label: "Block Slots", description: "Maintenance & events" },
    { href: "/admin/sports", label: "Manage Sports", description: "Enable/disable courts" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Admin Overview</h1>
        <p className="mt-1 text-zinc-400">
          Manage bookings, pricing, and courts
        </p>
      </div>

      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
            >
              <div className="flex items-center gap-2">
                <div className={`rounded-lg ${card.bg} p-1.5`}>
                  <Icon className={`h-4 w-4 ${card.color}`} />
                </div>
                <span className="text-xs text-zinc-500">{card.label}</span>
              </div>
              <p className="mt-3 text-2xl font-bold text-white">{card.value}</p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {quickLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-5 transition-all hover:border-zinc-700"
          >
            <div>
              <p className="font-medium text-white">{link.label}</p>
              <p className="text-sm text-zinc-500">{link.description}</p>
            </div>
            <ArrowRight className="h-5 w-5 text-zinc-600 transition-transform group-hover:translate-x-1 group-hover:text-zinc-400" />
          </Link>
        ))}
      </div>
    </div>
  );
}
