import { redirect } from "next/navigation";
import Link from "next/link";
import { MessageCircle, User as UserIcon } from "lucide-react";
import { auth } from "@/lib/auth";
import { LoginButton } from "@/components/login-modal";

/**
 * Top-level Account route that handles BOTH signed-in and signed-out
 * states. The bottom nav points here so an anonymous user tapping
 * "Account" doesn't hit a wall — they see the same hero + perks the
 * mobile RN app shows.
 *
 * Signed-in users are bounced to /dashboard which has the full
 * upcoming-bookings / rewards / quick-actions surface. Keeping them
 * as separate pages means the dashboard can stay inside the
 * (protected) route group (no auth-state branching inside its
 * heavy data-fetching code).
 */
export default async function AccountPage() {
  const session = await auth();
  if (session?.user?.id) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-8 sm:py-12">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15">
          <UserIcon className="h-9 w-9 text-emerald-400" />
        </div>
        <h1 className="text-2xl font-bold text-white">
          Sign in to Momentum Arena
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          View your bookings, speed up checkout, and earn your first-booking
          discount.
        </p>
        <div className="mt-5 flex justify-center">
          <LoginButton />
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <Perk
          emoji="📅"
          title="Track your bookings"
          body="See upcoming slots, booking IDs, and check-in details."
        />
        <Divider />
        <Perk
          emoji="⚡"
          title="Faster checkout"
          body="We'll remember your phone and preferences."
        />
        <Divider />
        <Perk
          emoji="🎁"
          title="First booking offer"
          body="Flat ₹100 off is applied automatically at checkout."
        />
      </section>

      {/* Chat tile — sits above the version footer, same placement
          as the mobile app's signed-out Account screen. */}
      <Link
        href="/chat"
        className="mt-5 flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 transition-colors hover:border-emerald-500/40"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/15">
          <MessageCircle className="h-5 w-5 text-emerald-400" />
        </div>
        <div className="flex-1">
          <p className="font-medium text-white">Arena Assistant</p>
          <p className="text-xs text-zinc-400">
            Quick questions about courts, hours, or your past bookings.
          </p>
        </div>
      </Link>

      <p className="mt-6 text-center text-xs text-zinc-600">v1.0</p>
    </main>
  );
}

function Perk({
  emoji,
  title,
  body,
}: {
  emoji: string;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      <span className="text-lg">{emoji}</span>
      <div className="flex-1">
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="text-xs text-zinc-400">{body}</p>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="my-1 border-t border-zinc-800" />;
}
