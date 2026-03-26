import Link from "next/link";
import Image from "next/image";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center relative overflow-hidden px-4">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Bouncing ball 1 */}
        <div className="absolute animate-bounce-slow" style={{ top: "10%", left: "15%", animationDelay: "0s" }}>
          <div className="w-8 h-8 rounded-full bg-emerald-500/20 blur-sm" />
        </div>
        {/* Bouncing ball 2 */}
        <div className="absolute animate-bounce-slow" style={{ top: "20%", right: "20%", animationDelay: "1s" }}>
          <div className="w-6 h-6 rounded-full bg-yellow-500/20 blur-sm" />
        </div>
        {/* Bouncing ball 3 */}
        <div className="absolute animate-bounce-slow" style={{ bottom: "30%", left: "10%", animationDelay: "0.5s" }}>
          <div className="w-10 h-10 rounded-full bg-blue-500/15 blur-sm" />
        </div>
        {/* Floating sports emojis */}
        <div className="absolute text-4xl opacity-10 animate-float" style={{ top: "15%", left: "8%" }}>🏏</div>
        <div className="absolute text-4xl opacity-10 animate-float-delayed" style={{ top: "25%", right: "12%" }}>⚽</div>
        <div className="absolute text-4xl opacity-10 animate-float" style={{ bottom: "25%", left: "20%" }}>🏸</div>
        <div className="absolute text-4xl opacity-10 animate-float-delayed" style={{ bottom: "20%", right: "15%" }}>🏓</div>
        <div className="absolute text-3xl opacity-10 animate-float" style={{ top: "50%", left: "5%" }}>☕</div>
        <div className="absolute text-3xl opacity-10 animate-float-delayed" style={{ top: "45%", right: "8%" }}>🎾</div>

        {/* Field lines */}
        <div className="absolute inset-0">
          <div className="absolute top-1/2 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500/10 to-transparent" />
          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-gradient-to-b from-transparent via-emerald-500/10 to-transparent" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full border border-emerald-500/10" />
        </div>

        {/* Corner arcs */}
        <div className="absolute top-0 left-0 w-24 h-24 border-b-2 border-r-2 border-emerald-500/5 rounded-br-full" />
        <div className="absolute top-0 right-0 w-24 h-24 border-b-2 border-l-2 border-emerald-500/5 rounded-bl-full" />
        <div className="absolute bottom-0 left-0 w-24 h-24 border-t-2 border-r-2 border-emerald-500/5 rounded-tr-full" />
        <div className="absolute bottom-0 right-0 w-24 h-24 border-t-2 border-l-2 border-emerald-500/5 rounded-tl-full" />
      </div>

      {/* Main content */}
      <div className="relative z-10 text-center max-w-lg">
        {/* Logo */}
        <div className="mb-8 animate-fade-in">
          <Image
            src="/blackLogo.png"
            alt="Momentum Arena"
            width={120}
            height={40}
            className="mx-auto opacity-60"
          />
        </div>

        {/* 404 with spinning cricket ball */}
        <div className="relative mb-6 animate-fade-in-up flex items-center justify-center gap-0">
          <span className="text-[120px] sm:text-[160px] font-black text-transparent bg-clip-text bg-gradient-to-b from-zinc-500 to-zinc-700 leading-none select-none">
            4
          </span>
          <div className="relative w-[100px] h-[120px] sm:w-[140px] sm:h-[160px] flex items-center justify-center">
            {/* Spinning cricket ball */}
            <div className="animate-spin-slow">
              <svg width="90" height="90" viewBox="0 0 90 90" className="sm:w-[120px] sm:h-[120px]" fill="none">
                <circle cx="45" cy="45" r="42" fill="#dc2626" stroke="#991b1b" strokeWidth="2"/>
                <path d="M20 30 Q45 15 70 30" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                <path d="M20 60 Q45 75 70 60" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                <line x1="22" y1="33" x2="22" y2="28" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="30" y1="27" x2="30" y2="23" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="38" y1="24" x2="38" y2="20" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="45" y1="23" x2="45" y2="19" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="52" y1="24" x2="52" y2="20" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="60" y1="27" x2="60" y2="23" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="68" y1="33" x2="68" y2="28" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="22" y1="57" x2="22" y2="62" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="30" y1="63" x2="30" y2="67" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="38" y1="66" x2="38" y2="70" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="45" y1="67" x2="45" y2="71" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="52" y1="66" x2="52" y2="70" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="60" y1="63" x2="60" y2="67" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="68" y1="57" x2="68" y2="62" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            {/* Glow effect behind ball */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-red-500/20 blur-xl animate-pulse" />
            </div>
          </div>
          <span className="text-[120px] sm:text-[160px] font-black text-transparent bg-clip-text bg-gradient-to-b from-zinc-500 to-zinc-700 leading-none select-none">
            4
          </span>
        </div>

        {/* Message */}
        <div className="animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
            Out of Bounds!
          </h2>
          <p className="text-zinc-400 text-base sm:text-lg mb-8 leading-relaxed">
            Looks like this shot went wide. The page you&apos;re looking for
            doesn&apos;t exist or has been moved to a different pitch.
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-in-up" style={{ animationDelay: "0.4s" }}>
          <Link
            href="/"
            className="group inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-emerald-600/25"
          >
            <svg className="w-4 h-4 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Back to Home
          </Link>
          <Link
            href="/book/cricket"
            className="group inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl border border-zinc-700 text-zinc-300 font-semibold text-sm hover:bg-zinc-900 hover:text-white hover:border-zinc-600 transition-all duration-300"
          >
            Book a Court
            <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </div>

        {/* Fun fact */}
        <div className="mt-12 animate-fade-in-up" style={{ animationDelay: "0.6s" }}>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-900/80 border border-zinc-800">
            <span className="text-base">💡</span>
            <span className="text-xs text-zinc-500">
              Fun fact: A cricket ball can travel over 160 km/h
            </span>
          </div>
        </div>
      </div>

      {/* Custom CSS animations */}
      <style>{`
        @keyframes bounce-slow {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-30px); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          25% { transform: translateY(-15px) rotate(5deg); }
          75% { transform: translateY(10px) rotate(-5deg); }
        }
        @keyframes float-delayed {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          25% { transform: translateY(10px) rotate(-3deg); }
          75% { transform: translateY(-20px) rotate(3deg); }
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-bounce-slow {
          animation: bounce-slow 3s ease-in-out infinite;
        }
        .animate-float {
          animation: float 6s ease-in-out infinite;
        }
        .animate-float-delayed {
          animation: float-delayed 7s ease-in-out infinite;
        }
        .animate-spin-slow {
          animation: spin-slow 8s linear infinite;
        }
        .animate-fade-in {
          animation: fade-in 0.8s ease-out forwards;
        }
        .animate-fade-in-up {
          animation: fade-in-up 0.8s ease-out forwards;
          opacity: 0;
        }
      `}</style>
    </div>
  );
}
