import Link from "next/link";
import Image from "next/image";
import { auth } from "@/lib/auth";
import { LoginButton } from "@/components/login-modal";

export default async function BookLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

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
              <Link
                href="/book"
                className="hidden md:flex text-sm font-medium text-zinc-300 hover:text-emerald-400 transition"
              >
                🏟️ Sports
              </Link>
              <Link
                href="/cafe"
                className="hidden md:flex text-sm font-medium text-zinc-300 hover:text-amber-400 transition"
              >
                ☕ Cafe
              </Link>
            </div>

            <div className="flex items-center gap-4">
              {session?.user ? (
                <Link
                  href="/dashboard"
                  className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-400">
                    {(session.user.name?.charAt(0) || session.user.email?.charAt(0) || "?").toUpperCase()}
                  </div>
                  <span className="hidden sm:inline">{session.user.name || session.user.email}</span>
                </Link>
              ) : (
                <LoginButton />
              )}
            </div>
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
