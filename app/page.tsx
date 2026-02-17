import Image from "next/image";

export default function Home() {
  return (
    <main className="bg-black text-white">

      {/* HERO */}
      <section className="min-h-screen flex flex-col justify-center items-center text-center px-6">
        {/* Coming Soon Badge */}
        <div className="absolute top-10 left-1/2 -translate-x-1/2">
          <div className="px-6 py-2 rounded-full border border-white/30 
                          text-white text-xs md:text-sm 
                          tracking-widest font-medium">
            COMING SOON
          </div>
        </div>

        <h1 className="text-5xl md:text-7xl font-bold mb-6">
          Momentum Arena
        </h1>

        <p className="text-xl md:text-2xl text-gray-300 mb-6">
          Cricket • Football • Pickleball • Badminton
        </p>

        <p className="text-gray-400 mb-10">
          Multi-Sport Facility in Mathura
        </p>

        <div className="flex gap-4 flex-wrap justify-center">
          <a
            href="https://wa.me/916396177261"
            className="bg-green-500 hover:bg-green-600 text-black font-semibold px-8 py-4 rounded-full transition"
          >
            Contact via WhatsApp
          </a>

          <a
            href="https://instagram.com/momentumarena_"
            target="_blank"
            className="border border-white px-8 py-4 rounded-full hover:bg-white hover:text-black transition"
          >
            Follow on Instagram
          </a>
        </div>
      </section>

      {/* SPORTS SECTION */}
      <section className="py-20 bg-gray-950">
        <h2 className="text-4xl font-bold text-center mb-12">
          Our Sports
        </h2>

        <div className="grid md:grid-cols-4 gap-6 px-8">

        <SportCard
          name="Cricket"
          image="/cricket.png"
        />

        <SportCard
          name="Football"
          image="https://images.pexels.com/photos/274506/pexels-photo-274506.jpeg"
        />

        <SportCard
          name="Pickleball"
          image="/pickleball.png"
        />

        <SportCard
          name="Badminton"
          image="/badminton.png"
        />

        </div>
      </section>

      {/* FACILITIES */}
      <section className="py-20 bg-gray-900 text-center px-6">
        <h2 className="text-4xl font-bold mb-12">
          Comfort Beyond The Game
        </h2>

        <div className="grid md:grid-cols-2 gap-10 max-w-5xl mx-auto">

          {/* Seating */}
          <div className="bg-black p-10 rounded-2xl">
            <div className="text-5xl mb-6">🪑</div>
            <h3 className="text-2xl font-semibold mb-4">
              Spectator Seating Area
            </h3>
            <p className="text-gray-400">
              Dedicated seating space for friends and family to enjoy matches comfortably.
              Ideal for tournaments and evening games.
            </p>
          </div>

          {/* Cafeteria */}
          <div className="bg-black p-10 rounded-2xl">
            <div className="text-5xl mb-6">☕</div>
            <h3 className="text-2xl font-semibold mb-4">
              Cafeteria & Refreshments
            </h3>
            <p className="text-gray-400">
              Snacks and beverages available so players can relax and recharge
              before or after their match.
            </p>
          </div>

        </div>
      </section>



      {/* CTA */}
      <section className="py-20 bg-green-500 text-black text-center">
        <h2 className="text-4xl font-bold mb-6">
          Be Among The First To Play
        </h2>

        <div className="flex gap-4 justify-center flex-wrap">
          <a
            href="https://wa.me/916396177261"
            className="bg-black text-white px-10 py-4 rounded-full font-semibold"
          >
            Contact via WhatsApp
          </a>

          <a
            href="https://instagram.com/momentumarena_"
            target="_blank"
            className="border border-black px-10 py-4 rounded-full"
          >
            See Construction Updates
          </a>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-10 text-center text-gray-500">
        © 2026 Momentum Arena • Mathura
      </footer>

    </main>
  );
}

function SportCard({ name, image }: { name: string; image: string }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl">
      <img
        src={image}
        alt={name}
        className="object-cover w-full h-80 group-hover:scale-110 transition duration-500"
      />
      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
        <h3 className="text-2xl font-bold">{name}</h3>
      </div>
    </div>
  );
}
