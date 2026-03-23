import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { auth, signOut } from "@/lib/auth";
import {
  LayoutDashboard,
  CalendarCheck,
  DollarSign,
  CalendarOff,
  Dumbbell,
  Users,
  Ticket,
  Megaphone,
  HelpCircle,
} from "lucide-react";

const adminNavItems = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/admin/pricing", label: "Pricing", icon: DollarSign },
  { href: "/admin/slots", label: "Slot Blocks", icon: CalendarOff },
  { href: "/admin/sports", label: "Sports", icon: Dumbbell },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/discounts", label: "Discounts", icon: Ticket },
  { href: "/admin/banners", label: "Banners", icon: Megaphone },
  { href: "/admin/faqs", label: "FAQs", icon: HelpCircle },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

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
                  width={140}
                  height={45}
                />
              </Link>
              <span className="rounded-md bg-red-600/20 px-2 py-1 text-xs font-medium text-red-400 border border-red-600/30">
                Admin
              </span>
            </div>

            <div className="flex items-center gap-4">
              <Link
                href="/dashboard"
                className="text-sm text-zinc-400 hover:text-zinc-300"
              >
                User Dashboard
              </Link>
              <span className="text-sm text-zinc-400">
                {session.user.name || session.user.email}
              </span>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <button
                  type="submit"
                  className="rounded-md bg-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700 transition-colors"
                >
                  Sign Out
                </button>
              </form>
            </div>
          </div>
        </div>
      </nav>

      {/* Admin Sub-nav */}
      <div className="border-b border-zinc-800 bg-zinc-950/50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex gap-1 overflow-x-auto py-2">
            {adminNavItems.map((item) => {
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
