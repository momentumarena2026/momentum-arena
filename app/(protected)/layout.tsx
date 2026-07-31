import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";

/**
 * Account-area layout (dashboard, bookings, rewards, notifications,
 * profile…). Used to render a slim logo+avatar bar with none of the
 * section links — now it carries the same SiteHeader as the rest of
 * the site so navigation reads identically everywhere.
 */
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="min-h-screen bg-black">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
