import Image from "next/image";
import Link from "next/link";
import { FaWhatsapp, FaInstagram, FaYoutube } from "react-icons/fa";
import {
  MdSportsCricket,
  MdSportsSoccer,
  MdSportsTennis,
} from "react-icons/md";
import { ArrowRight, Bell, Calendar, ChevronRight, Clock } from "lucide-react";
import { LoginButton } from "@/components/login-modal";
import { StoreBadges } from "@/components/store-badges";
import { unreadNotificationCount } from "@/lib/user-notifications";
import { HomepageSportTracker, HomepageCafeTracker, HomepageCallTracker, HomepageDirectionsTracker } from "@/components/homepage-tracker";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { SPORT_INFO, customerFacingCourtLabel, formatHoursAsRanges } from "@/lib/court-config";
import { formatBookingDate, formatPrice } from "@/lib/pricing";
import { getActiveSportPromo } from "@/actions/sport-promo";
import { getRainBanner, getInfoBar } from "@/actions/admin-arena-settings";
import { arePassesEnabled } from "@/lib/passes";
import { areTournamentsEnabled } from "@/lib/tournaments";
import { areCampsEnabled } from "@/lib/camps";
import { RainBanner } from "@/components/rain-banner";
import { PromoBannerSlot } from "@/components/promo-banner-slot";

const sports = [
  {
    name: "Cricket",
    slug: "cricket",
    image: "/cricket.png",
    tagline: "Professional Turf & Bowling Machine",
    icon: MdSportsCricket,
    color: "emerald",
    gradient: "from-emerald-500/80 to-emerald-900/90",
    border: "hover:border-emerald-400 hover:shadow-emerald-500/20",
    glow: "group-hover:shadow-[0_0_30px_rgba(16,185,129,0.3)]",
  },
  {
    name: "Football",
    slug: "football",
    image: "/football.jpeg",
    tagline: "Full-Size Turf Under Floodlights",
    icon: MdSportsSoccer,
    color: "blue",
    gradient: "from-blue-500/80 to-blue-900/90",
    border: "hover:border-blue-400 hover:shadow-blue-500/20",
    glow: "group-hover:shadow-[0_0_30px_rgba(59,130,246,0.3)]",
  },
  {
    name: "Pickleball",
    slug: "pickleball",
    image: "/pickleball.png",
    tagline: "Fast-Growing Sport, Professional Court",
    icon: MdSportsTennis,
    color: "yellow",
    gradient: "from-yellow-500/80 to-yellow-900/90",
    border: "hover:border-yellow-400 hover:shadow-yellow-500/20",
    glow: "group-hover:shadow-[0_0_30px_rgba(234,179,8,0.3)]",
    // promoLabel is computed at render time from the live PICKLEBALL25
    // coupon (see `getActiveSportPromo` call inside Home), so flipping
    // isActive=false in /admin/coupons hides the pill + banner here on
    // the next request — no separate hardcoded toggle to remember.
  },
];

// Per-sport accent for the "Your upcoming bookings" cards. Mirrors
// the dashboard SPORT_COLORS map so a signed-in user lands on the
// home page with the same visual cues they get on /dashboard. Kept
// locally instead of importing the dashboard's copy so the home
// page is self-contained (it's an unauthenticated route).
const UPCOMING_SPORT_COLORS: Record<
  string,
  { bg: string; border: string; text: string; glow: string }
> = {
  CRICKET: {
    bg: "from-emerald-500/20 to-emerald-600/5",
    border: "border-emerald-500/30 hover:border-emerald-400/50",
    text: "text-emerald-400",
    glow: "shadow-emerald-500/10",
  },
  FOOTBALL: {
    bg: "from-blue-500/20 to-blue-600/5",
    border: "border-blue-500/30 hover:border-blue-400/50",
    text: "text-blue-400",
    glow: "shadow-blue-500/10",
  },
  PICKLEBALL: {
    bg: "from-yellow-500/20 to-yellow-600/5",
    border: "border-yellow-500/30 hover:border-yellow-400/50",
    text: "text-yellow-400",
    glow: "shadow-yellow-500/10",
  },
};
const UPCOMING_SPORT_ICONS: Record<string, React.ReactNode> = {
  CRICKET: <MdSportsCricket className="h-5 w-5" />,
  FOOTBALL: <MdSportsSoccer className="h-5 w-5" />,
  PICKLEBALL: <MdSportsTennis className="h-5 w-5" />,
};

const facilities = [
  {
    icon: "🏟️",
    title: "Professional Turf",
    desc: "High-quality artificial turf designed for competitive play across all sports.",
  },
  {
    icon: "🌧️",
    title: "All-Weather Turf",
    desc: "Rain doesn't slow us down — a quick-drain surface keeps play uninterrupted.",
  },
  {
    icon: "💡",
    title: "Floodlights",
    desc: "Play day or night with professional-grade floodlighting on all courts.",
  },
  {
    icon: "🪑",
    title: "Spectator Seating",
    desc: "Comfortable seating for friends and family to watch matches live.",
  },
  {
    icon: "☕",
    title: "Cafeteria",
    desc: "Snacks, beverages and refreshments to recharge before or after your game.",
  },
  {
    icon: "🅿️",
    title: "Ample Parking",
    desc: "Spacious parking area for hassle-free arrivals.",
  },
  {
    icon: "🚻",
    title: "Clean Washrooms",
    desc: "Separate, well-maintained male and female washrooms for your comfort.",
  },
];

export default async function Home() {
  // Pull the signed-in user's next few CONFIRMED bookings so the
  // home page mirrors the mobile RN HomeScreen's "Your upcoming
  // bookings" strip — same shape, same per-sport accent, same
  // "See all" affordance pointing at the bookings list.
  //
  // auth() is allowed to throw on misconfigured envs (e.g. preview
  // deploys without NEXTAUTH_SECRET); we swallow rather than break
  // the public landing page.
  let upcomingBookings: Array<{
    id: string;
    date: Date;
    totalAmount: number;
    wasBookedAsHalfCourt: boolean;
    courtConfig: { sport: string; label: string };
    slots: { startHour: number }[];
  }> = [];
  // Hoisted out of the try below: the header needs the session (and the
  // unread count) too, and the original was scoped to the bookings fetch.
  let session = null;
  try {
    session = await auth();
  } catch {
    // Auth failure must not blank the public homepage.
  }
  const homeUnread = session?.user?.id
    ? await unreadNotificationCount(session.user.id).catch(() => 0)
    : 0;

  try {
    if (session?.user?.id) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      upcomingBookings = await db.booking.findMany({
        where: {
          userId: session.user.id,
          status: "CONFIRMED",
          date: { gte: today },
        },
        include: {
          courtConfig: { select: { sport: true, label: true } },
          slots: {
            select: { startHour: true },
            orderBy: { startHour: "asc" },
          },
        },
        orderBy: { date: "asc" },
        take: 3,
      });
    }
  } catch {
    // Anonymous / auth misconfigured — leave the section hidden.
  }

  // Live PICKLEBALL25 promo lookup — drives the 25% OFF pill on the
  // pickleball tile AND the launch-offer banner above the sports
  // grid. When admin disables / expires the coupon in /admin/coupons
  // this returns null and both pieces vanish on the next request.
  // No try/catch: the DB call already returns null on any disqualifier,
  // and a missing coupon row throws upstream which we'd want to see.
  const pickleballPromo = await getActiveSportPromo("PICKLEBALL").catch(
    () => null,
  );
  const pickleballPromoLabel =
    pickleballPromo?.percentOff != null
      ? `${pickleballPromo.percentOff}% OFF`
      : null;

  // "Rain doesn't slow us down" banner — shown when it's raining in Mathura
  // (AUTO) or forced on by admin. Never throws.
  const passesEnabled = await arePassesEnabled().catch(() => false);
  const tournamentsEnabled = await areTournamentsEnabled().catch(() => false);
  const campsEnabled = await areCampsEnabled().catch(() => false);
  const rainBanner = await getRainBanner().catch(() => ({
    show: false,
    title: "",
    body: "",
  }));
  // Admin-configurable announcement strip; falls back to the new-user
  // offer copy, and disappears entirely when switched off.
  const infoBar = await getInfoBar().catch(() => ({ show: false, text: "" }));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": "https://momentumarena.com/#organization",
    name: "Momentum Arena",
    image: "https://momentumarena.com/icon.png",
    logo: {
      "@type": "ImageObject",
      url: "https://momentumarena.com/icon.png",
      width: 512,
      height: 512,
    },
    description:
      "Momentum Arena is Mathura's premier multi-sport facility offering professional Cricket, Football and Pickleball courts with spectator seating and cafeteria",
    url: "https://momentumarena.com",
    telephone: "+91-6396177261",
    priceRange: "₹₹",
    address: {
      "@type": "PostalAddress",
      streetAddress:
        "Momentum Arena, Khasra no. 293/5, Mouja Ganeshra, Radhapuram Road",
      addressLocality: "Mathura",
      addressRegion: "Uttar Pradesh",
      postalCode: "281004",
      addressCountry: "IN",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: 27.509167,
      longitude: 77.638917,
    },
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday",
        ],
        opens: "05:00",
        closes: "01:00",
      },
    ],
    amenityFeature: [
      { "@type": "LocationFeatureSpecification", name: "Cricket Turf", value: true },
      { "@type": "LocationFeatureSpecification", name: "Football Turf", value: true },
      { "@type": "LocationFeatureSpecification", name: "Pickleball Courts", value: true },
      { "@type": "LocationFeatureSpecification", name: "Spectator Seating", value: true },
      { "@type": "LocationFeatureSpecification", name: "Cafeteria", value: true },
      { "@type": "LocationFeatureSpecification", name: "Parking", value: true },
    ],
    sameAs: [
      "https://instagram.com/momentumarena_",
      "https://www.youtube.com/@momentum_arena",
      "https://whatsapp.com/channel/0029VbCQo4S8fewv3rjVp03X",
    ],
    areaServed: {
      "@type": "City",
      name: "Mathura",
      containedInPlace: { "@type": "State", name: "Uttar Pradesh" },
    },
    knowsAbout: [
      "Cricket",
      "Football",
      "Pickleball",
      "Sports Facility Management",
      "Sports Court Rental",
      "Tournament Hosting",
    ],
  };

  const organizationSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Momentum Arena",
    url: "https://momentumarena.com",
    logo: "https://momentumarena.com/icon.png",
    image: "https://momentumarena.com/icon.png",
    description: "Mathura's premier multi-sport facility",
    address: {
      "@type": "PostalAddress",
      streetAddress: "Khasra no. 293/5, Mouja Ganeshra, Radhapuram Road",
      addressLocality: "Mathura",
      addressRegion: "Uttar Pradesh",
      postalCode: "281004",
      addressCountry: "IN",
    },
    contactPoint: {
      "@type": "ContactPoint",
      telephone: "+91-6396177261",
      contactType: "customer service",
    },
    sameAs: [
      "https://instagram.com/momentumarena_",
      "https://www.youtube.com/@momentum_arena",
      "https://whatsapp.com/channel/0029VbCQo4S8fewv3rjVp03X",
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
      />

      <main className="bg-black text-white overflow-x-hidden">
        {/* NAV BAR */}
        <nav className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-md border-b border-white/5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-20 gap-2">
            <Link href="/" className="flex-shrink-0">
              <Image
                src="/blackLogo.png"
                alt="Momentum Arena"
                width={200}
                height={65}
                className="h-16 sm:h-20 md:h-24 w-auto"
              />
            </Link>
            <div className="hidden md:flex items-center gap-8">
              <Link
                href="/book"
                className="text-base font-semibold text-zinc-300 hover:text-emerald-400 transition flex items-center gap-2"
              >
                🏟️ Sports
              </Link>
              <Link
                href="/cafe"
                className="text-base font-semibold text-zinc-300 hover:text-amber-400 transition flex items-center gap-2"
              >
                ☕ Cafe
              </Link>
              <Link
                href="/shop"
                className="text-base font-semibold text-zinc-300 hover:text-emerald-400 transition flex items-center gap-2"
              >
                🛍️ Shop
              </Link>
              {passesEnabled && (
                <Link
                  href="/passes"
                  className="text-base font-semibold text-zinc-300 hover:text-emerald-400 transition flex items-center gap-2"
                >
                  🎟️ Passes
                </Link>
              )}
              {tournamentsEnabled && (
                <Link
                  href="/tournaments"
                  className="text-base font-semibold text-zinc-300 hover:text-emerald-400 transition flex items-center gap-2"
                >
                  🏆 Tournaments
                </Link>
              )}
              {/* The home page renders its own nav rather than SiteHeader,
                  so links added there don't appear here — Camps was
                  missing on this page only. */}
              {campsEnabled && (
                <Link
                  href="/camps"
                  className="text-base font-semibold text-zinc-300 hover:text-violet-400 transition flex items-center gap-2"
                >
                  🎓 Camps
                </Link>
              )}
            </div>
            {/* Right cluster. On phones the account pill is dropped — the
                bottom nav already has an Account tab, and the pill's full
                name was taking the whole header for a duplicate route.
                What replaces it is what a phone visitor actually can't get
                elsewhere: their unread count, and a link to the app. */}
            <div className="flex items-center gap-3">
              {session?.user?.id && (
                <Link
                  href="/notifications"
                  aria-label="My Notifications"
                  className="relative rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white md:hidden"
                >
                  <Bell className="h-5 w-5" />
                  {homeUnread > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-emerald-950">
                      {homeUnread > 9 ? "9+" : homeUnread}
                    </span>
                  )}
                </Link>
              )}
              {/* Phones only: desktop gets the full badges in the footer,
                  and this row is already tight beside the nav links. */}
              <StoreBadges variant="icon" className="ml-1 md:hidden" />
              <LoginButton hideChipOnMobile />
            </div>
          </div>
        </nav>

        {/* Fixed announcement stack below the nav — the welcome offer, then
            the weather-aware rain banner (when shown). Stacked in one
            container so they never overlap. */}
        <div className="fixed top-20 left-0 right-0 z-40">
          {/* Promotional Banner — welcome offer for first-time bookers */}
          {infoBar.show && (
            <div className="bg-gradient-to-r from-emerald-600 to-emerald-500 text-white text-center py-2 px-4">
              <p className="text-xs sm:text-sm font-semibold">{infoBar.text}</p>
            </div>
          )}
          {/* Weather-aware "rain doesn't slow us down" banner (auto/on/off) */}
          {rainBanner.show ? (
            <RainBanner title={rainBanner.title} body={rainBanner.body} href="/book" />
          ) : null}
        </div>

        {/* HERO */}
        <section className="relative min-h-screen flex flex-col items-center justify-center text-center px-6 pt-16 mt-10">
          {/* Animated gradient background */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/30 via-black to-black" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-amber-900/15 via-transparent to-transparent" />

          {/* Animated floating orbs */}
          <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-1/3 right-1/4 w-64 h-64 bg-amber-500/8 rounded-full blur-3xl animate-pulse delay-1000" style={{ animationDelay: "2s" }} />

          {/* Grid pattern */}
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)",
              backgroundSize: "60px 60px",
            }}
          />

          <div className="relative z-10 max-w-4xl mx-auto">
            {/* Logo with glow */}
            <div className="mb-8 mx-auto w-48 sm:w-64 md:w-80 hover:scale-105 transition-transform duration-500 relative">
              <div className="absolute inset-0 bg-emerald-500/20 blur-3xl rounded-full scale-75" />
              <Image
                src="/blackLogo.png"
                alt="Momentum Arena Logo"
                width={400}
                height={400}
                className="w-full h-auto relative"
                priority
              />
            </div>

            <h1 className="text-xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-black tracking-tight mb-4 leading-tight px-2 whitespace-nowrap">
              <span className="block sm:inline">MATHURA&apos;S PREMIER</span>
              <br className="hidden sm:block" />
              <span className="block sm:inline bg-gradient-to-r from-emerald-400 via-emerald-500 to-amber-400 bg-clip-text text-transparent">
                MULTI-SPORT ARENA
              </span>
            </h1>

            <p className="text-lg sm:text-xl md:text-2xl text-zinc-400 mb-3">
              Cricket &bull; Football &bull; Pickleball
            </p>

            <p className="text-sm md:text-base text-zinc-500 mb-4">
              Professional courts &bull; Floodlights &bull; Cafeteria &bull; Open 5 AM &ndash; 1 AM
            </p>

            {/* All-weather badge — quick-drain turf USP */}
            <div className="mb-8 flex justify-center">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 text-xs font-semibold text-emerald-300 sm:text-sm">
                🌧️ Rain-proof turf &bull; quick drainage, uninterrupted play
              </span>
            </div>

            {/* Two per row on phones — Order Food + Book a Court, then
                Camps + Tournaments. Desktop keeps them on one line. */}
            <div className="mx-auto grid max-w-xl grid-cols-2 gap-3 sm:gap-4">
              <a
                href="#cafe"
                className="flex w-full items-center justify-center gap-2 rounded-full bg-amber-600 px-4 py-4 text-sm font-bold text-white transition-all duration-300 hover:scale-105 hover:bg-amber-700 hover:shadow-lg hover:shadow-amber-500/25 sm:px-6 sm:text-base md:text-lg"
              >
                ☕ Order Food
              </a>
              <a
                href="#sports"
                className="flex w-full items-center justify-center gap-2 rounded-full bg-emerald-600 px-4 py-4 text-sm font-bold text-white transition-all duration-300 hover:scale-105 hover:bg-emerald-700 hover:shadow-lg hover:shadow-emerald-500/25 sm:px-6 sm:text-base md:text-lg"
              >
                🏟️ Book a Court
              </a>
              {campsEnabled && (
                <Link
                  href="/camps"
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-violet-600 px-4 py-4 text-sm font-bold text-white transition-all duration-300 hover:scale-105 hover:bg-violet-500 hover:shadow-lg hover:shadow-violet-500/25 sm:px-6 sm:text-base md:text-lg"
                >
                  🎓 Camps
                </Link>
              )}
              {tournamentsEnabled && (
                <Link
                  href="/tournaments"
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-yellow-600 px-4 py-4 text-sm font-bold text-zinc-950 transition-all duration-300 hover:scale-105 hover:bg-yellow-500 hover:shadow-lg hover:shadow-yellow-500/25 sm:px-6 sm:text-base md:text-lg"
                >
                  🏆 Tournaments
                </Link>
              )}
            </div>
          </div>

          {/* Scroll indicator */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
            <div className="w-6 h-10 rounded-full border-2 border-zinc-600 flex items-start justify-center p-1.5">
              <div className="w-1.5 h-3 bg-zinc-500 rounded-full" />
            </div>
          </div>
        </section>

        {/* Admin-scheduled promotion banner (HOME_TOP) — sits right
            above the upcoming-bookings section, styled as the same
            rounded card as the pickleball promo. Renders whether or
            not the visitor has bookings. */}
        <PromoBannerSlot screen="HOME_TOP" variant="top" />

        {/* YOUR UPCOMING BOOKINGS — only renders for signed-in users
            with at least one confirmed booking. Mirrors the mobile RN
            HomeScreen section: header + "See all" link, first card
            tinted with the sport's accent + "NEXT" pill. */}
        {upcomingBookings.length > 0 && (
          <section className="py-10 md:py-12">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
              {/* Header row — kept on a single line at every breakpoint.
                  Michroma is a wide font, so on a 375px-wide phone with
                  px-4 (32px) padding the available width is ~343px. The
                  heading drops to text-sm there (~14px Michroma renders
                  "Your upcoming bookings" at ~245px); both heading and
                  the "See all" affordance get `whitespace-nowrap` so
                  flex can't split them, and `shrink-0` on the link
                  prevents the heading from squeezing it. */}
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-sm sm:text-xl md:text-2xl font-bold text-white whitespace-nowrap">
                  Your upcoming bookings
                </h2>
                <Link
                  href="/bookings"
                  className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs sm:text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  See all
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              <div className="space-y-2">
                {upcomingBookings.map((booking, index) => {
                  const sport = booking.courtConfig.sport;
                  const sportInfo = SPORT_INFO[sport as keyof typeof SPORT_INFO];
                  const accent =
                    UPCOMING_SPORT_COLORS[sport] ?? UPCOMING_SPORT_COLORS.CRICKET;
                  const sportIcon =
                    UPCOMING_SPORT_ICONS[sport] ?? UPCOMING_SPORT_ICONS.CRICKET;
                  const isNext = index === 0;

                  return (
                    <Link
                      key={booking.id}
                      href={`/book/confirmation?id=${booking.id}`}
                      className={`group block rounded-xl border p-4 transition-all ${
                        isNext
                          ? `${accent.border} bg-gradient-to-r ${accent.bg} hover:shadow-lg ${accent.glow}`
                          : "border-zinc-800/80 bg-zinc-900/60 hover:border-zinc-700"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`shrink-0 rounded-lg p-2 ${
                            isNext
                              ? "bg-white/5 ring-1 ring-white/10"
                              : "bg-zinc-800"
                          }`}
                        >
                          <span className={accent.text}>{sportIcon}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-white truncate">
                              {sportInfo?.name ?? sport}
                            </p>
                            {isNext && (
                              <span className="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                                Next
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-zinc-500 truncate">
                            {customerFacingCourtLabel(
                              booking.courtConfig.label,
                              booking.wasBookedAsHalfCourt,
                            )}
                          </p>
                        </div>
                        <div className="shrink-0 flex items-center gap-1">
                          <span className={`text-sm font-bold ${accent.text}`}>
                            {formatPrice(booking.totalAmount)}
                          </span>
                          <ChevronRight className="h-4 w-4 text-zinc-700 group-hover:text-zinc-400 group-hover:translate-x-0.5 transition-all" />
                        </div>
                      </div>

                      <div className="mt-2 ml-[44px] flex items-center gap-4 text-xs text-zinc-400">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3 shrink-0" />
                          {formatBookingDate(booking.date, {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                          })}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3 shrink-0" />
                          {formatHoursAsRanges(
                            booking.slots.map((s) => s.startHour),
                          )}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* SPORTS SECTION */}
        <section id="sports" className="py-16 md:py-24 scroll-mt-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-5xl font-black mb-3">
                <span className="bg-gradient-to-r from-emerald-400 to-green-500 bg-clip-text text-transparent">CHOOSE YOUR SPORT</span> 🏟️
              </h2>
              <p className="text-zinc-500 text-base md:text-lg">
                Select a sport to book your court instantly
              </p>
            </div>

            {/* Admin-managed promotion banners (Web & App Config) — the
                pickleball launch banner now lives here as a seeded
                PromoBanner row linked to PICKLEBALL25, so it (and any
                future promo) retires with its coupon automatically. */}
            <PromoBannerSlot screen="HOME_PROMO" className="mb-8 md:mb-10" />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
              {sports.map((sport) => {
                const Icon = sport.icon;

                return (
                  <HomepageSportTracker key={sport.slug} sport={sport.name}>
                  <Link
                    href={`/book/${sport.slug}`}
                    className={`group relative overflow-hidden rounded-2xl h-64 sm:h-72 md:h-80 border border-zinc-800 transition-all duration-500 ${sport.border} ${sport.glow}`}
                  >
                    {/* Background image */}
                    <img
                      src={sport.image}
                      alt={`${sport.name} at Momentum Arena`}
                      className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                    />

                    {/* Gradient overlay */}
                    <div
                      className={`absolute inset-0 bg-gradient-to-t ${sport.gradient} opacity-80 group-hover:opacity-90 transition-opacity duration-500`}
                    />

                    {/* Launch-promo pill (top-right). Driven by the
                        live PICKLEBALL25 coupon — disabling it in
                        /admin/coupons hides this pill on the next
                        request. Today only pickleball ships a promo;
                        other sports get null. */}
                    {sport.slug === "pickleball" && pickleballPromoLabel ? (
                      <span className="absolute right-3 top-3 z-10 rounded-full border border-yellow-300/60 bg-yellow-400/95 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-900 shadow-lg shadow-yellow-500/30">
                        {pickleballPromoLabel}
                      </span>
                    ) : null}

                    {/* Content */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                      <Icon className="text-4xl md:text-5xl text-white/80 mb-3 group-hover:scale-110 transition-transform duration-300" />
                      <h3 className="text-2xl md:text-3xl font-black text-white mb-1">
                        {sport.name}
                      </h3>
                      <p className="text-sm md:text-base text-white/70">
                        {sport.tagline}
                      </p>
                      <div className="mt-4 px-5 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-sm font-semibold text-white opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-300">
                        Book Now &rarr;
                      </div>
                    </div>
                  </Link>
                  </HomepageSportTracker>
                );
              })}
            </div>

          </div>
        </section>

        {/* CAFE SECTION */}
        <section id="cafe" className="py-16 md:py-24 bg-gradient-to-b from-black via-amber-950/10 to-black scroll-mt-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-5xl font-black mb-3">
                <span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">MOMENTUM CAFE</span> ☕
              </h2>
              <p className="text-zinc-500 text-base md:text-lg">
                Fuel your game with fresh snacks, beverages &amp; meals
              </p>
            </div>

            <HomepageCafeTracker>
            <Link
              href="/cafe"
              className="group relative overflow-hidden rounded-3xl h-[480px] sm:h-80 md:h-96 border-2 border-amber-500/30 transition-all duration-500 hover:border-amber-400 hover:shadow-2xl hover:shadow-amber-500/20 block"
            >
              {/* Background image */}
              <img
                src="/cafe.jpg"
                alt="Cafeteria at Momentum Arena"
                className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
              />
              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/40" />
              <div className="absolute inset-0 bg-gradient-to-r from-amber-900/40 to-transparent" />

              {/* Content */}
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 sm:justify-end sm:p-12 text-center">
                <div className="text-5xl md:text-6xl mb-3 group-hover:scale-110 transition-transform duration-300">☕</div>
                <h3 className="text-2xl sm:text-3xl md:text-4xl font-black text-white mb-2">
                  Order Now
                </h3>
                <p className="text-sm sm:text-base md:text-lg text-white/70 mb-4 sm:mb-6 max-w-md">
                  Snacks, fresh beverages, hot meals &amp; combos — served at the arena — no online deliveries 
                </p>
                <div className="flex gap-2 sm:gap-3 flex-wrap justify-center">
                  <span className="px-3 sm:px-4 py-1 sm:py-1.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs sm:text-sm font-medium">🍿 Snacks</span>
                  <span className="px-3 sm:px-4 py-1 sm:py-1.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs sm:text-sm font-medium">🥤 Beverages</span>
                  <span className="px-3 sm:px-4 py-1 sm:py-1.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs sm:text-sm font-medium">🍛 Meals</span>
                  <span className="px-3 sm:px-4 py-1 sm:py-1.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs sm:text-sm font-medium">🍰 Desserts</span>
                </div>
                <div className="mt-4 sm:mt-6 px-6 sm:px-8 py-2.5 sm:py-3 rounded-full bg-amber-500 hover:bg-amber-600 text-black font-bold text-sm sm:text-base transition-all duration-300 group-hover:scale-105 group-hover:shadow-lg group-hover:shadow-amber-500/30">
                  Browse Menu &amp; Order &rarr;
                </div>
              </div>
            </Link>
            </HomepageCafeTracker>
          </div>
        </section>

        {/* FACILITIES */}
        <section
          id="facilities"
          className="py-16 md:py-24 bg-zinc-950 scroll-mt-16"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-5xl font-black mb-3">
                WORLD-CLASS FACILITIES
              </h2>
              <p className="text-zinc-500 text-base md:text-lg">
                Everything you need for the perfect game
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
              {facilities.map((f) => (
                <div
                  key={f.title}
                  className="group relative overflow-hidden bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 md:p-8 hover:border-emerald-500/40 transition-all duration-500 hover:shadow-lg hover:shadow-emerald-500/10 hover:-translate-y-1"
                >
                  {/* Hover glow */}
                  <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <div className="relative">
                    <div className="text-4xl md:text-5xl mb-4 group-hover:scale-110 transition-transform duration-300">{f.icon}</div>
                    <h3 className="text-lg md:text-xl font-bold text-white mb-2 group-hover:text-emerald-400 transition-colors duration-300">
                      {f.title}
                    </h3>
                    <p className="text-sm md:text-base text-zinc-400">
                      {f.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ARENA LAYOUT — top-down "what's where" view of the venue.
            Sits between the facilities grid and the location/contact
            block so it acts as a bridge: facilities tell you WHAT we
            have, layout tells you HOW IT'S ARRANGED, location tells
            you HOW TO GET HERE. */}
        <section
          id="layout"
          className="py-16 md:py-24 bg-gradient-to-b from-black via-emerald-950/10 to-black scroll-mt-16"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <p className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-emerald-300 mb-3">
                The arena, at a glance
              </p>
              <h2 className="text-3xl md:text-5xl font-black mb-3">
                <span className="bg-gradient-to-r from-emerald-400 to-green-500 bg-clip-text text-transparent">
                  EVERYTHING UNDER
                </span>{" "}
                <span className="text-white">ONE ROOF</span> 🏟️
              </h2>
              <p className="text-zinc-500 text-base md:text-lg max-w-2xl mx-auto">
                Multi-sport turf, a dedicated pickleball court, cafe + washrooms,
                and a chill-out lawn — all on a 10,000 sq ft floodlit ground.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-start">
              {/* Layout image — top-down view of the venue with
                  dimension labels baked in. Click → opens full-size
                  in a new tab for power users. */}
              <a
                href="/arena-layout.jpg"
                target="_blank"
                rel="noopener noreferrer"
                className="group block relative overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-emerald-500/10 transition-all duration-500 hover:border-emerald-500/40"
                aria-label="Open the full arena layout in a new tab"
              >
                <Image
                  src="/arena-layout.jpg"
                  alt="Top-down layout of Momentum Arena — cricket/football shared turf (80×90 ft), pickleball court (50×25 ft), cafe & washrooms (20×35 ft), green area (50×10 ft), 10ft entrance. Total 80×125 ft."
                  width={900}
                  height={1350}
                  className="h-auto w-full"
                  sizes="(min-width: 1024px) 540px, 100vw"
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-gradient-to-t from-black/90 to-transparent px-4 py-3 opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="text-xs text-zinc-300">Tap to view full size</span>
                  <span className="text-xs font-semibold text-emerald-300">↗</span>
                </div>
              </a>

              {/* What's where — feature breakdown with the same numbers
                  the image shows, but spelled out as a scannable list
                  + quick-fact pills. */}
              <div className="space-y-6">
                {/* Headline stats — tightened mobile font + padding so
                    "10,000" (the widest entry) fits inside its column on
                    narrow viewports. Was overflowing at text-2xl with
                    p-4 + the gap-3 grid on ~390px viewports. */}
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3 sm:p-4 text-center">
                    <p className="text-lg sm:text-2xl md:text-3xl font-black text-emerald-400 leading-tight tracking-tight">
                      10,000
                    </p>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300/80 mt-1">
                      sq ft total
                    </p>
                  </div>
                  <div className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-3 sm:p-4 text-center">
                    <p className="text-lg sm:text-2xl md:text-3xl font-black text-blue-400 leading-tight">
                      3
                    </p>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-300/80 mt-1">
                      sports on site
                    </p>
                  </div>
                  <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 sm:p-4 text-center">
                    <p className="text-lg sm:text-2xl md:text-3xl font-black text-amber-400 leading-tight">
                      24×7
                    </p>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-300/80 mt-1">
                      floodlit
                    </p>
                  </div>
                </div>

                {/* What's where rows — each row mirrors a colored
                    region on the layout image so the eye can map
                    them quickly. */}
                <ul className="space-y-3">
                  <LayoutRow
                    swatch="bg-emerald-500"
                    title="Cricket / Football shared turf"
                    dims="80 ft × 90 ft"
                    desc="Full-size 6v6 football pitch doubling as box-cricket with the pitch line down the middle. Pro-grade artificial turf."
                  />
                  <LayoutRow
                    swatch="bg-blue-500"
                    title="Pickleball court"
                    dims="50 ft × 25 ft"
                    desc="Dedicated court with regulation 20×44 ft playable area, professional net + line markings."
                  />
                  <LayoutRow
                    swatch="bg-zinc-500"
                    title="Cafe & washrooms"
                    dims="20 ft × 35 ft"
                    desc="Snacks, beverages, hot meals + clean separate washrooms. Sit, eat, freshen up."
                  />
                  <LayoutRow
                    swatch="bg-emerald-600/70"
                    title="Green chill-out area"
                    dims="50 ft × 10 ft"
                    desc="Manicured lawn between the courts and cafe — bring the kids, hang out between games."
                  />
                  <LayoutRow
                    swatch="bg-zinc-600"
                    title="Main entrance"
                    dims="10 ft wide"
                    desc="Lit gateway between the courts and the cafe. Drop-off and parking right outside."
                  />
                </ul>

                {/* Mini perks strip */}
                <div className="flex flex-wrap gap-2">
                  {[
                    "💡 Floodlights",
                    "🪑 Spectator seating",
                    "🅿️ Free parking",
                    "🚻 Clean washrooms",
                    "📶 Wi-Fi at the cafe",
                  ].map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-300"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* LOCATION & CONTACT */}
        <section id="location" className="py-16 md:py-24 scroll-mt-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-5xl font-black mb-3">
                FIND US IN MATHURA
              </h2>
              <p className="text-zinc-500 text-base md:text-lg">
                Visit us for the best sporting experience
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-8 md:gap-12">
              {/* Info */}
              <div className="space-y-8">
                <div className="space-y-4">
                  <div className="flex items-start gap-4">
                    <span className="text-emerald-500 text-xl mt-0.5">📍</span>
                    <div>
                      <h4 className="font-semibold text-white mb-1">Address</h4>
                      <p className="text-zinc-400 text-sm">
                        Khasra no. 293/5, Mouja Ganeshra
                        <br />
                        Radhapuram Road, Mathura, UP 281004
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <span className="text-emerald-500 text-xl mt-0.5">📞</span>
                    <div>
                      <h4 className="font-semibold text-white mb-1">Phone</h4>
                      <HomepageCallTracker>
                      <a
                        href="tel:+916396177261"
                        className="text-zinc-400 text-sm hover:text-emerald-400 transition"
                      >
                        +91 63961 77261
                      </a>
                      </HomepageCallTracker>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <span className="text-emerald-500 text-xl mt-0.5">🕐</span>
                    <div>
                      <h4 className="font-semibold text-white mb-1">
                        Opening Hours
                      </h4>
                      <p className="text-zinc-400 text-sm">
                        Every day: 5:00 AM &ndash; 1:00 AM
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <span className="text-emerald-500 text-xl mt-0.5">✉️</span>
                    <div>
                      <h4 className="font-semibold text-white mb-1">Email</h4>
                      <a
                        href="mailto:momentumarena2026@gmail.com"
                        className="text-zinc-400 text-sm hover:text-emerald-400 transition"
                      >
                        momentumarena2026@gmail.com
                      </a>
                    </div>
                  </div>
                </div>

                {/* Contact via WhatsApp */}
                <div>
                  <a
                    href="https://wa.me/916396177261"
                    className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#1ebe57] text-white px-6 py-3 rounded-full text-sm font-bold transition shadow-lg shadow-green-900/20 hover:scale-105"
                  >
                    <FaWhatsapp className="text-xl" />
                    Contact Us on WhatsApp
                  </a>
                </div>

                {/* Follow Us */}
                <div>
                  <h4 className="font-semibold text-white mb-3">Follow Us</h4>
                  <div className="flex flex-wrap gap-3">
                    <a
                      href="https://whatsapp.com/channel/0029VbCQo4S8fewv3rjVp03X"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 bg-[#25D366] hover:bg-[#1ebe57] text-white px-5 py-2.5 rounded-full text-sm font-semibold transition shadow-lg shadow-green-900/20"
                    >
                      <FaWhatsapp className="text-lg" />
                      WhatsApp Channel
                    </a>
                    <a
                      href="https://instagram.com/momentumarena_"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-white px-5 py-2.5 rounded-full text-sm font-semibold transition shadow-lg shadow-pink-900/20"
                      style={{ background: "linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)" }}
                    >
                      <FaInstagram className="text-lg" />
                      Instagram
                    </a>
                    <a
                      href="https://www.youtube.com/@momentum_arena"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 bg-[#FF0000] hover:bg-[#cc0000] text-white px-5 py-2.5 rounded-full text-sm font-semibold transition shadow-lg shadow-red-900/20"
                    >
                      <FaYoutube className="text-lg" />
                      YouTube
                    </a>
                  </div>
                </div>
              </div>

              {/* Map */}
              <div className="bg-zinc-900 rounded-2xl overflow-hidden h-80 md:h-full min-h-[320px] border border-zinc-800">
                <iframe
                  src="https://www.google.com/maps/embed?pb=!1m17!1m12!1m3!1d3542.7!2d77.638917!3d27.509167!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m2!1m1!2zMjfCsDMwJzMzLjAiTiA3N8KwMzgnMjAuNyJF!5e1!3m2!1sen!2sin!4v1234567890"
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  title="Momentum Arena Location - Mathura, Uttar Pradesh"
                />
              </div>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        {/* BottomNav now ships its own spacer (see components/bottom-nav.tsx),
            so the footer no longer needs `pb-24` mobile clearance — that
            was double-padding once the spacer landed. */}
        <footer className="border-t border-zinc-900 py-8">
          {/* Get-the-app row. Full badges here rather than the header's
              bare glyphs: the footer has the room for the wording, and a
              visitor who has read the whole page is a better moment to ask
              than one who just landed. StoreBadges picks the right
              store(s) for the device. */}
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-8 flex flex-col items-center gap-3 border-b border-zinc-900 pb-8 sm:flex-row sm:justify-between">
            <div className="text-center sm:text-left">
              <p className="text-sm font-semibold text-white">
                Get the Momentum Arena app
              </p>
              <p className="text-xs text-zinc-500">
                Book faster, track your passes and follow matches live.
              </p>
            </div>
            <StoreBadges variant="full" />
          </div>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex flex-col items-center sm:items-start gap-1">
              <p className="text-zinc-600 text-sm">
                &copy; 2026 Momentum Arena &bull; Mathura, UP
              </p>
              <a
                href="/policies"
                className="cursor-pointer text-xs text-zinc-500 hover:text-emerald-400 transition-colors"
              >
                Terms, Privacy &amp; Refund Policy
              </a>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="https://whatsapp.com/channel/0029VbCQo4S8fewv3rjVp03X"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center w-9 h-9 rounded-full bg-[#25D366] hover:bg-[#1ebe57] text-white transition shadow-sm"
              >
                <FaWhatsapp className="text-base" />
              </a>
              <a
                href="https://instagram.com/momentumarena_"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center w-9 h-9 rounded-full text-white transition shadow-sm"
                style={{ background: "linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)" }}
              >
                <FaInstagram className="text-base" />
              </a>
              <a
                href="https://www.youtube.com/@momentum_arena"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center w-9 h-9 rounded-full bg-[#FF0000] hover:bg-[#cc0000] text-white transition shadow-sm"
              >
                <FaYoutube className="text-base" />
              </a>
            </div>
          </div>
        </footer>
      </main>

    </>
  );
}

/**
 * Single row in the "what's where" list inside the Arena Layout
 * section. Colored swatch on the left mirrors the corresponding
 * region on the layout image so the eye can map them at a glance.
 */
function LayoutRow({
  swatch,
  title,
  dims,
  desc,
}: {
  swatch: string;
  title: string;
  dims: string;
  desc: string;
}) {
  return (
    <li className="flex items-start gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 transition-colors hover:border-zinc-700">
      <span
        className={`mt-1.5 inline-block h-3.5 w-3.5 shrink-0 rounded-sm ${swatch}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm md:text-base font-semibold text-white">{title}</p>
          <p className="text-xs font-mono text-emerald-300/80">{dims}</p>
        </div>
        <p className="mt-1 text-xs md:text-sm text-zinc-400 leading-relaxed">
          {desc}
        </p>
      </div>
    </li>
  );
}
