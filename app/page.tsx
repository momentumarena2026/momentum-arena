import Image from "next/image";
import { FaWhatsapp, FaInstagram, FaYoutube } from "react-icons/fa";

export default function Home() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": "https://momentumarena.com/#organization",
    "name": "Momentum Arena",
    "image": "/logo.png",
    "description": "Momentum Arena is Mathura's premier multi-sport facility offering professional Cricket, Football, Pickleball and Badminton courts with spectator seating and cafeteria",
    "url": "https://momentumarena.com",
    "telephone": "+91-6396177261",
    "priceRange": "₹₹",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "Mathura",
      "addressLocality": "Mathura",
      "addressRegion": "Uttar Pradesh",
      "postalCode": "281001",
      "addressCountry": "IN"
    },
    "geo": {
      "@type": "GeoCoordinates",
      "latitude": 27.509167,
      "longitude": 77.638917
    },
    "openingHoursSpecification": [
      {
        "@type": "OpeningHoursSpecification",
        "dayOfWeek": [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday"
        ],
        "opens": "06:00",
        "closes": "23:00"
      }
    ],
    "amenityFeature": [
      {
        "@type": "LocationFeatureSpecification",
        "name": "Cricket Turf",
        "value": true
      },
      {
        "@type": "LocationFeatureSpecification",
        "name": "Football Turf",
        "value": true
      },
      {
        "@type": "LocationFeatureSpecification",
        "name": "Pickleball Courts",
        "value": true
      },
      {
        "@type": "LocationFeatureSpecification",
        "name": "Badminton Courts",
        "value": true
      },
      {
        "@type": "LocationFeatureSpecification",
        "name": "Spectator Seating",
        "value": true
      },
      {
        "@type": "LocationFeatureSpecification",
        "name": "Cafeteria",
        "value": true
      },
      {
        "@type": "LocationFeatureSpecification",
        "name": "Parking",
        "value": true
      }
    ],
    "sameAs": [
      "https://instagram.com/momentumarena_",
      "https://www.youtube.com/@momentum_arena",
      "https://whatsapp.com/channel/0029VbCQo4S8fewv3rjVp03X"
    ],
    "areaServed": {
      "@type": "City",
      "name": "Mathura",
      "containedInPlace": {
        "@type": "State",
        "name": "Uttar Pradesh"
      }
    },
    "knowsAbout": [
      "Cricket",
      "Football",
      "Pickleball",
      "Badminton",
      "Sports Facility Management",
      "Sports Court Rental",
      "Tournament Hosting"
    ]
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="bg-black text-white">

      {/* HERO */}
      <section className="min-h-screen flex flex-col justify-center items-center text-center px-6 py-20 relative">
        {/* Coming Soon Badge */}
        <div className="absolute top-6 md:top-10 left-1/2 -translate-x-1/2 z-10">
          <div className="px-4 py-2 md:px-6 md:py-2 rounded-full border border-white/30 
                          text-white text-xs md:text-sm 
                          tracking-widest font-medium">
            COMING SOON
          </div>
        </div>

        {/* Logo */}
          <div className="mt-16 md:mt-0 mb-6 md:mb-8 hover:scale-105 transition-all duration-300 w-64 sm:w-80 md:w-96 lg:w-[500px]">
            <Image
              src="/blackLogo.png"
              alt="Momentum Arena Logo"
              width={500}
              height={500}
              className="w-full h-auto object-contain"
              priority
            />
          </div>

        <p className="text-lg md:text-xl lg:text-2xl text-gray-300 mb-4 md:mb-6">
          Cricket • Football • Pickleball • Badminton
        </p>

        <p className="text-sm md:text-base text-gray-400 mb-8 md:mb-10">
          Multi-Sport Facility in Mathura
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4 w-full max-w-2xl px-4">
          <a
            href="https://wa.me/916396177261"
            className="bg-green-500 hover:bg-green-600 text-black font-semibold px-6 py-3 md:px-8 md:py-4 rounded-full transition flex items-center justify-center gap-2 text-sm md:text-base"
          >
            <FaWhatsapp className="text-xl md:text-2xl" />
            Contact Us
          </a>

          <a
            href="https://instagram.com/momentumarena_"
            target="_blank"
            rel="noopener noreferrer"
            className="border border-white px-6 py-3 md:px-8 md:py-4 rounded-full hover:bg-white hover:text-black transition flex items-center justify-center gap-2 text-sm md:text-base"
          >
            <FaInstagram className="text-xl md:text-2xl" />
            Instagram
          </a>

          <a
            href="https://whatsapp.com/channel/0029VbCQo4S8fewv3rjVp03X"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-3 md:px-8 md:py-4 rounded-full transition flex items-center justify-center gap-2 text-sm md:text-base"
          >
            <FaWhatsapp className="text-xl md:text-2xl" />
            WhatsApp Channel
          </a>

          <a
            href="https://www.youtube.com/@momentum_arena"
            target="_blank"
            rel="noopener noreferrer"
            className="border border-red-600 text-red-600 hover:bg-red-600 hover:text-white px-6 py-3 md:px-8 md:py-4 rounded-full transition flex items-center justify-center gap-2 text-sm md:text-base"
          >
            <FaYoutube className="text-xl md:text-2xl" />
            YouTube
          </a>
        </div>
      </section>

      {/* SPORTS SECTION */}
      <section className="py-12 md:py-20 bg-gray-950">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-8 md:mb-12 px-4">
          Our Sports
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 px-4 md:px-8">

        <SportCard
          name="Cricket"
          image="/cricket.png"
          description="Professional cricket turf in Mathura"
        />

        <SportCard
          name="Football"
          image="https://images.pexels.com/photos/274506/pexels-photo-274506.jpeg"
          description="Full-size football field"
        />

        <SportCard
          name="Pickleball"
          image="/pickleball.png"
          description="Modern pickleball courts"
        />

        <SportCard
          name="Badminton"
          image="/badminton.png"
          description="Indoor badminton courts"
        />

        </div>
      </section>

      {/* FACILITIES */}
      <section className="py-12 md:py-20 bg-gray-900 text-center px-4 md:px-6">
        <h2 className="text-3xl md:text-4xl font-bold mb-8 md:mb-12">
          Comfort Beyond The Game
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10 max-w-5xl mx-auto">

          {/* Seating */}
          <div className="bg-black p-6 md:p-10 rounded-2xl">
            <div className="text-4xl md:text-5xl mb-4 md:mb-6">🪑</div>
            <h3 className="text-xl md:text-2xl font-semibold mb-3 md:mb-4">
              Spectator Seating Area
            </h3>
            <p className="text-gray-400 text-sm md:text-base">
              Dedicated seating space for friends and family to enjoy matches comfortably.
              Ideal for tournaments and evening games.
            </p>
          </div>

          {/* Cafeteria */}
          <div className="bg-black p-6 md:p-10 rounded-2xl">
            <div className="text-4xl md:text-5xl mb-4 md:mb-6">☕</div>
            <h3 className="text-xl md:text-2xl font-semibold mb-3 md:mb-4">
              Cafeteria & Refreshments
            </h3>
            <p className="text-gray-400 text-sm md:text-base">
              Snacks and beverages available so players can relax and recharge
              before or after their match.
            </p>
          </div>

        </div>
      </section>



      {/* CTA */}
      <section className="py-20 bg-green-500 text-black text-center px-6">
        <h2 className="text-3xl md:text-4xl font-bold mb-6">
          Be Among The First To Play
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4 max-w-2xl mx-auto px-4">
          <a
            href="https://wa.me/916396177261"
            className="bg-black text-white px-6 py-3 md:px-10 md:py-4 rounded-full font-semibold flex items-center justify-center gap-2 text-sm md:text-base"
          >
            <FaWhatsapp className="text-xl" />
            Contact Us
          </a>

          <a
            href="https://instagram.com/momentumarena_"
            target="_blank"
            rel="noopener noreferrer"
            className="border-2 border-black px-6 py-3 md:px-10 md:py-4 rounded-full hover:bg-black hover:text-white transition flex items-center justify-center gap-2 text-sm md:text-base"
          >
            <FaInstagram className="text-xl" />
            Updates
          </a>

          <a
            href="https://whatsapp.com/channel/0029VbCQo4S8fewv3rjVp03X"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-black text-white px-6 py-3 md:px-10 md:py-4 rounded-full font-semibold flex items-center justify-center gap-2 text-sm md:text-base"
          >
            <FaWhatsapp className="text-xl" />
            Channel
          </a>

          <a
            href="https://www.youtube.com/@momentum_arena"
            target="_blank"
            rel="noopener noreferrer"
            className="border-2 border-black px-6 py-3 md:px-10 md:py-4 rounded-full hover:bg-black hover:text-white transition flex items-center justify-center gap-2 text-sm md:text-base"
          >
            <FaYoutube className="text-xl" />
            YouTube
          </a>
        </div>
      </section>

      {/* LOCATION & CONTACT */}
      <section className="py-12 md:py-20 bg-black text-white">
        <div className="max-w-6xl mx-auto px-4 md:px-6">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-8 md:mb-12">
            Find Us in Mathura
          </h2>

          <div className="grid md:grid-cols-2 gap-8 md:gap-12">
            {/* Contact Info */}
            <div className="space-y-6">
              <div>
                <h3 className="text-2xl font-semibold mb-4 text-green-500">
                  Contact Information
                </h3>
                <div className="space-y-3">
                  <p className="flex items-start gap-3 text-gray-300">
                    <span className="text-green-500 mt-1">📍</span>
                    <span>Mathura, Uttar Pradesh 281001</span>
                  </p>
                  <p className="flex items-start gap-3 text-gray-300">
                    <span className="text-green-500 mt-1">📞</span>
                    <a href="tel:+916396177261" className="hover:text-green-500 transition">
                      +91 6396177261
                    </a>
                  </p>
                </div>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-3 text-green-500">
                  Services We Offer
                </h3>
                <ul className="space-y-2 text-gray-300">
                  <li className="flex items-center gap-2">
                    <span className="text-green-500">✓</span>
                    Cricket Turf Booking
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-green-500">✓</span>
                    Professional Bowling Machine Training
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-green-500">✓</span>
                    Football Turf Rental
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-green-500">✓</span>
                    Pickleball Court Booking
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-green-500">✓</span>
                    Badminton Court Rental
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-green-500">✓</span>
                    Tournament Hosting
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-green-500">✓</span>
                    Corporate Sports Events
                  </li>
                </ul>
              </div>
            </div>

            {/* Google Maps */}
            <div className="bg-gray-900 rounded-2xl overflow-hidden h-96 md:h-full">
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
      <footer className="py-8 md:py-10 text-center text-gray-500 text-sm md:text-base px-4">
        © 2026 Momentum Arena • Mathura
      </footer>

    </main>
    </>
  );
}

function SportCard({ name, image, description }: { name: string; image: string; description: string }) {
  return (
    <article className="group relative overflow-hidden rounded-2xl h-64 md:h-80">
      <img
        src={image}
        alt={`${name} court at Momentum Arena - ${description}`}
        className="object-cover w-full h-full group-hover:scale-110 transition duration-500"
      />
      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
        <h3 className="text-xl md:text-2xl font-bold">{name}</h3>
      </div>
    </article>
  );
}
