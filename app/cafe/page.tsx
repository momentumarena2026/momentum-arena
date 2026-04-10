import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function CafePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </Link>
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-12 text-center">
        <h2 className="text-2xl font-bold text-white">Momentum Cafe</h2>
        <p className="mt-2 text-amber-400 font-semibold">Coming Soon</p>
        <p className="mt-3 text-sm text-zinc-400">
          The cafe is currently under construction. We&apos;ll be serving up
          something delicious very soon.
        </p>
      </div>
    </div>
  );
}
