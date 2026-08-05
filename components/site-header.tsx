import Link from "next/link";
import Image from "next/image";
import { Bell } from "lucide-react";
import { auth } from "@/lib/auth";
import { unreadNotificationCount } from "@/lib/user-notifications";
import { LoginButton } from "@/components/login-modal";
import { RewardsChip } from "@/components/rewards/rewards-chip";
import { arePassesEnabled } from "@/lib/passes";
import { areTournamentsEnabled } from "@/lib/tournaments";
import { areCampsEnabled } from "@/lib/camps";
import { StoreBadges } from "@/components/store-badges";
import { AppCtaBar } from "@/components/app-cta-bar";

type Section = "sports" | "cafe" | "shop" | "passes" | "tournaments" | "camps";

/**
 * Shared customer-funnel top nav (logo + section links + rewards chip +
 * account/login). Previously copy-pasted inline into /book and /shop
 * layouts; extracted so every funnel page — including /passes, which had
 * no layout and rendered bare against the black page — carries the same
 * header. The Passes link only shows while the passes storefront is on.
 *
 * The active section is rendered in its accent colour (emerald, or amber
 * for Cafe) instead of the hover-only zinc used for the rest.
 */
export async function SiteHeader({ active }: { active?: Section }) {
  const [session, passesEnabled, tournamentsEnabled, campsEnabled] = await Promise.all([
    auth(),
    arePassesEnabled().catch(() => false),
    areTournamentsEnabled().catch(() => false),
    areCampsEnabled().catch(() => false),
  ]);
  const unread = session?.user?.id
    ? await unreadNotificationCount(session.user.id).catch(() => 0)
    : 0;

  const base = "hidden md:flex text-sm font-medium transition";
  const linkClass = (section: Section, hover: string) =>
    active === section
      ? `${base} ${section === "cafe" ? "text-amber-400" : "text-emerald-400"}`
      : `${base} text-zinc-300 ${hover}`;

  return (
    <>
    <nav className="border-b border-zinc-800 bg-zinc-950">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/">
              {/* h-14 on phones — at h-24 the 3:1 logo alone is ~288px
                  wide and overflows small viewports (same fix as the
                  cafe + protected-layout headers). */}
              <Image
                src="/blackLogo.png"
                alt="Momentum Arena"
                width={240}
                height={80}
                className="h-14 w-auto sm:h-24"
              />
            </Link>
            <Link href="/book" className={linkClass("sports", "hover:text-emerald-400")}>
              🏟️ Sports
            </Link>
            <Link href="/cafe" className={linkClass("cafe", "hover:text-amber-400")}>
              ☕ Cafe
            </Link>
            <Link href="/shop" className={linkClass("shop", "hover:text-emerald-400")}>
              🛍️ Shop
            </Link>
            {passesEnabled && (
              <Link
                href="/passes"
                className={linkClass("passes", "hover:text-emerald-400")}
              >
                🎟️ Passes
              </Link>
            )}
            {tournamentsEnabled && (
              <Link
                href="/tournaments"
                className={linkClass("tournaments", "hover:text-emerald-400")}
              >
                🏆 Tournaments
              </Link>
            )}
            {/* Desktop only — on mobile Camps lives in the bottom-nav arc,
                which is where the other venue destinations sit. */}
            {campsEnabled && (
              <Link
                href="/camps"
                className={linkClass("camps", "hover:text-emerald-400")}
              >
                🎓 Camps
              </Link>
            )}
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            {session?.user?.id && (
              <Link
                href="/notifications"
                aria-label="My Notifications"
                className="relative rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
              >
                <Bell className="h-5 w-5" />
                {unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-emerald-950">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </Link>
            )}
            {/* Phones: the app link replaces the account avatar below.
                Desktop has no bottom nav, so it keeps the avatar and gets
                its badges in the footer instead. */}
            <StoreBadges variant="icon" className="ml-1 md:hidden" />
            {session?.user?.id && <RewardsChip userId={session.user.id} />}
            {session?.user ? (
              <Link
                href="/dashboard"
                className="hidden md:flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-400">
                  {(
                    session.user.name?.charAt(0) ||
                    session.user.email?.charAt(0) ||
                    "?"
                  ).toUpperCase()}
                </div>
                {/* Name is desktop-only: on phones the right cluster is the
                    notification bell + avatar, so a long name doesn't crowd
                    them out. `md` (768px) rather than `sm` so big phones and
                    small tablets in portrait stay on the compact layout. */}
                <span className="hidden md:inline">
                  {session.user.name || session.user.email}
                </span>
              </Link>
            ) : (
              <LoginButton />
            )}
          </div>
        </div>
      </div>
    </nav>
    <AppCtaBar />
    </>
  );
}
