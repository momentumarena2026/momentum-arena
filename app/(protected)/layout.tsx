import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { auth, signOut } from "@/lib/auth";
import { SetPasswordWrapper } from "@/components/set-password-wrapper";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="min-h-screen bg-black">
      <nav className="border-b border-zinc-800 bg-zinc-950">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <Link href="/">
              <Image
                src="/blackLogo.png"
                alt="Momentum Arena"
                width={240}
                height={80}
                className="h-24 w-auto"
              />
            </Link>

            <div className="flex items-center gap-4">
              <Link
                href="/dashboard"
                className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-400">
                  {(session.user.name?.charAt(0) || session.user.email?.charAt(0) || "?").toUpperCase()}
                </div>
                {session.user.name || session.user.email}
              </Link>
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
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
      <SetPasswordWrapper />
    </div>
  );
}
