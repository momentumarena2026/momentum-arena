import Image from "next/image";
import Link from "next/link";
import { FaWhatsapp, FaInstagram, FaYoutube } from "react-icons/fa";
import {
  MdSportsCricket,
  MdSportsSoccer,
  MdSportsTennis,
  MdSportsHandball,
} from "react-icons/md";
import { LoginButton } from "@/components/login-modal";
import { ChatNavButton } from "@/components/chatbot/chat-nav-button";

const sports = [
  {
    name: "Cricket",
    slug: "cricket",
    image: "/cricket.png",
    tagline: "Professional Turf with Bowling Machine",
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
    tagline: "Fast-Growing Sport, Pro Courts",
    icon: MdSportsTennis,
    color: "yellow",
    gradient: "from-yellow-500/80 to-yellow-900/90",
    border: "hover:border-yellow-400 hover:shadow-yellow-500/20",
    glow: "group-hover:shadow-[0_0_30px_rgba(234,179,8,0.3)]",
  },
  {
    name: "Badminton",
    slug: "badminton",
    image: "/badminton.png",
    tagline: "Indoor Courts, Shuttle Ready",
    icon: MdSportsHandball,
    color: "purple",
    gradient: "from-purple-500/80 to-purple-900/90",
    border: "hover:border-purple-400 hover:shadow-purple-500/20",
    glow: "group-hover:shadow-[0_0_30px_rgba(168,85,247,0.3)]",
  },
];

const facilities = [
  {
    icon: "🏟️",
    title: "Professional Turf",
    desc: "High-quality artificial turf designed for competitive play across all sports.",
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

export default function Home() {
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
      "Momentum Arena is Mathura's premier multi-sport facility offering professional Cricket, Football, Pickleball and Badminton courts with spectator seating and cafeteria",
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
      { "@type": "LocationFeatureSpecification", name: "Badminton Courts", value: true },
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
      "Badminton",
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
            </div>
            <LoginButton />
          </div>
        </nav>

        {/* Promotional Banner */}
        <div className="fixed top-20 left-0 right-0 z-40 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white text-center py-2 px-4">
          <p className="text-xs sm:text-sm font-semibold">
            Flat ₹100 OFF on online bookings! No coupon needed — applied automatically at checkout.
            <span className="ml-1 opacity-80">Limited period offer.</span>
          </p>
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
              Cricket &bull; Football &bull; Pickleball &bull; Badminton
            </p>

            <p className="text-sm md:text-base text-zinc-500 mb-8">
              Professional courts &bull; Floodlights &bull; Cafeteria &bull; Open 5 AM &ndash; 1 AM
            </p>

            <div className="flex items-center justify-center gap-4 flex-wrap">
              <a
                href="#sports"
                className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-8 py-4 rounded-full text-base md:text-lg transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-emerald-500/25"
              >
                🏟️ Book a Court
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </a>
              <a
                href="#cafe"
                className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-bold px-8 py-4 rounded-full text-base md:text-lg transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-amber-500/25"
              >
                ☕ Order Food
              </a>
            </div>
          </div>

          {/* Scroll indicator */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
            <div className="w-6 h-10 rounded-full border-2 border-zinc-600 flex items-start justify-center p-1.5">
              <div className="w-1.5 h-3 bg-zinc-500 rounded-full" />
            </div>
          </div>
        </section>

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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
              {sports.map((sport) => {
                const Icon = sport.icon;
                return (
                  <Link
                    key={sport.slug}
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

            <Link
              href="/cafe"
              className="group relative overflow-hidden rounded-3xl h-72 sm:h-80 md:h-96 border-2 border-amber-500/30 transition-all duration-500 hover:border-amber-400 hover:shadow-2xl hover:shadow-amber-500/20 block"
            >
              {/* Background image */}
              <img
                src="/cafe.jpg"
                alt="Cafeteria at Momentum Arena"
                className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
              />
              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-r from-amber-900/40 to-transparent" />

              {/* Content */}
              <div className="absolute inset-0 flex flex-col items-center justify-end p-8 sm:p-12 text-center">
                <div className="text-5xl md:text-6xl mb-4 group-hover:scale-110 transition-transform duration-300">☕</div>
                <h3 className="text-3xl md:text-4xl font-black text-white mb-2">
                  Order Now
                </h3>
                <p className="text-base md:text-lg text-white/70 mb-6 max-w-md">
                  Snacks, fresh beverages, hot meals &amp; combos — served at the arena
                </p>
                <div className="flex gap-3 flex-wrap justify-center">
                  <span className="px-4 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-sm font-medium">🍿 Snacks</span>
                  <span className="px-4 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-sm font-medium">🥤 Beverages</span>
                  <span className="px-4 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-sm font-medium">🍛 Meals</span>
                  <span className="px-4 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-sm font-medium">🍰 Desserts</span>
                </div>
                <div className="mt-6 px-8 py-3 rounded-full bg-amber-500 hover:bg-amber-600 text-black font-bold text-base transition-all duration-300 group-hover:scale-105 group-hover:shadow-lg group-hover:shadow-amber-500/30">
                  Browse Menu &amp; Order &rarr;
                </div>
              </div>
            </Link>
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
                      <a
                        href="tel:+916396177261"
                        className="text-zinc-400 text-sm hover:text-emerald-400 transition"
                      >
                        +91 63961 77261
                      </a>
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
                  src="https://www.google.com/maps/embed?pb=!1m17!1m12!1m3!1d3542.7!2d77.638917!3d27.509167!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m2!1m1!2zMjfCsDMwJzMzLjAiTiA3N8KwMzgnMjAuNyJF!5e0!3m2!1sen!2sin!4v1234567890"
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
        <footer className="border-t border-zinc-900 py-8 pb-24 md:pb-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-zinc-600 text-sm">
              &copy; 2026 Momentum Arena &bull; Mathura, UP
            </p>
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

      {/* Mobile bottom tab navigation */}
      <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-black/95 backdrop-blur-md border-t border-zinc-800">
        <div className="flex items-center justify-around py-2.5">
          <Link
            href="/"
            className="flex flex-col items-center gap-0.5 text-zinc-400 hover:text-white transition"
          >
            <span className="text-lg">🏠</span>
            <span className="text-[10px] font-medium">Home</span>
          </Link>
          <Link
            href="/book"
            className="flex flex-col items-center gap-0.5 text-zinc-400 hover:text-emerald-400 transition"
          >
            <span className="text-lg">🏟️</span>
            <span className="text-[10px] font-medium">Sports</span>
          </Link>
          <Link
            href="/cafe"
            className="flex flex-col items-center gap-0.5 text-zinc-400 hover:text-amber-400 transition"
          >
            <span className="text-lg">☕</span>
            <span className="text-[10px] font-medium">Cafe</span>
          </Link>
          <Link
            href="/dashboard"
            className="flex flex-col items-center gap-0.5 text-zinc-400 hover:text-white transition"
          >
            <span className="text-lg">👤</span>
            <span className="text-[10px] font-medium">Account</span>
          </Link>
          <ChatNavButton />
        </div>
      </div>
    </>
  );
}
