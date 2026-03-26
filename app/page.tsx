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
                className="h-12 sm:h-14 md:h-16 w-auto"
              />
            </Link>
            <div className="hidden md:flex items-center gap-8">
              <a
                href="#sports"
                className="text-sm text-zinc-400 hover:text-white transition"
              >
                Sports
              </a>
              <a
                href="#facilities"
                className="text-sm text-zinc-400 hover:text-white transition"
              >
                Facilities
              </a>
              <a
                href="#location"
                className="text-sm text-zinc-400 hover:text-white transition"
              >
                Location
              </a>
            </div>
            <LoginButton />
          </div>
        </nav>

        {/* HERO */}
        <section className="relative min-h-screen flex flex-col items-center justify-center text-center px-6 pt-16">
          {/* Background gradient */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-emerald-900/20 via-black to-black" />

          {/* Subtle grid pattern */}
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)",
              backgroundSize: "60px 60px",
            }}
          />

          <div className="relative z-10 max-w-4xl mx-auto">
            {/* Logo */}
            <div className="mb-8 mx-auto w-48 sm:w-64 md:w-80 hover:scale-105 transition-transform duration-500">
              <Image
                src="/blackLogo.png"
                alt="Momentum Arena Logo"
                width={400}
                height={400}
                className="w-full h-auto"
                priority
              />
            </div>

            <h1 className="text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-black tracking-tight mb-4 leading-tight px-2">
              MATHURA&apos;S PREMIER
              <br />
              <span className="bg-gradient-to-r from-emerald-400 to-emerald-600 bg-clip-text text-transparent">
                MULTI-SPORT ARENA
              </span>
            </h1>

            <p className="text-lg sm:text-xl md:text-2xl text-zinc-400 mb-3">
              Cricket &bull; Football &bull; Pickleball &bull; Badminton
            </p>

            <p className="text-sm md:text-base text-zinc-500 mb-10">
              Professional courts &bull; Floodlights &bull; Open 5 AM &ndash; 1
              AM
            </p>

            <a
              href="#sports"
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-8 py-4 rounded-full text-base md:text-lg transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-emerald-500/25"
            >
              Book Your Court Now
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </a>
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
                CHOOSE YOUR SPORT
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

            {/* Cafe Card */}
            <div className="mt-6">
              <Link
                href="/cafe"
                className="group relative overflow-hidden rounded-2xl h-48 sm:h-56 border border-zinc-800 transition-all duration-500 hover:border-amber-400 hover:shadow-amber-500/20 block"
              >
                {/* Background image */}
                <img
                  src="/cafe.jpg"
                  alt="Cafeteria at Momentum Arena"
                  className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                />
                {/* Gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/50 to-transparent" />
                <div className="absolute inset-0 flex items-center justify-between px-8 sm:px-12">
                  <div>
                    <div className="text-4xl md:text-5xl mb-2">☕</div>
                    <h3 className="text-2xl md:text-3xl font-black text-white mb-1">
                      Cafeteria
                    </h3>
                    <p className="text-sm md:text-base text-white/70">
                      Snacks, Beverages &amp; Meals
                    </p>
                  </div>
                  <div className="px-5 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-sm font-semibold text-white opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0 transition-all duration-300">
                    Order Now &rarr;
                  </div>
                </div>
              </Link>
            </div>
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
                  className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 md:p-8 hover:border-zinc-700 transition-colors duration-300"
                >
                  <div className="text-3xl md:text-4xl mb-4">{f.icon}</div>
                  <h3 className="text-lg md:text-xl font-bold text-white mb-2">
                    {f.title}
                  </h3>
                  <p className="text-sm md:text-base text-zinc-400">
                    {f.desc}
                  </p>
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

                {/* Social links */}
                <div className="flex gap-3">
                  <a
                    href="https://wa.me/916396177261"
                    className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-full text-sm font-semibold transition"
                  >
                    <FaWhatsapp className="text-lg" />
                    WhatsApp
                  </a>
                  <a
                    href="https://instagram.com/momentumarena_"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 border border-zinc-700 hover:border-zinc-500 text-zinc-300 px-5 py-2.5 rounded-full text-sm font-semibold transition"
                  >
                    <FaInstagram className="text-lg" />
                    Instagram
                  </a>
                  <a
                    href="https://www.youtube.com/@momentum_arena"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 border border-zinc-700 hover:border-red-500 text-zinc-300 hover:text-red-400 px-5 py-2.5 rounded-full text-sm font-semibold transition"
                  >
                    <FaYoutube className="text-lg" />
                    YouTube
                  </a>
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
        <footer className="border-t border-zinc-900 py-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-zinc-600 text-sm">
              &copy; 2026 Momentum Arena &bull; Mathura, UP
            </p>
            <div className="flex items-center gap-4">
              <a
                href="https://wa.me/916396177261"
                className="text-zinc-600 hover:text-green-500 transition"
              >
                <FaWhatsapp className="text-lg" />
              </a>
              <a
                href="https://instagram.com/momentumarena_"
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-600 hover:text-pink-500 transition"
              >
                <FaInstagram className="text-lg" />
              </a>
              <a
                href="https://www.youtube.com/@momentum_arena"
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-600 hover:text-red-500 transition"
              >
                <FaYoutube className="text-lg" />
              </a>
            </div>
          </div>
        </footer>
      </main>
    </>
  );
}
