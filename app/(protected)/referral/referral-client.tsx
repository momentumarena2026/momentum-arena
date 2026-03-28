"use client";

import { useState } from "react";
import { Copy, Check, Share2, Users, Gift, ArrowRight } from "lucide-react";

interface ReferralClientProps {
  referralCode: string;
  totalReferrals: number;
  totalDiscountGiven: number; // paise
}

export function ReferralClient({
  referralCode,
  totalReferrals,
  totalDiscountGiven,
}: ReferralClientProps) {
  const [copied, setCopied] = useState(false);

  const shareMessage = `Join Momentum Arena with my code ${referralCode} and get ₹100 off your first booking! https://momentumarena.in`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareMessage)}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(referralCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select input
    }
  }

  async function handleShare() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: "Join Momentum Arena",
          text: shareMessage,
          url: "https://momentumarena.in",
        });
        return;
      } catch {
        // fall through to copy
      }
    }
    // Fallback: copy to clipboard
    await handleCopy();
  }

  const earnedInRupees = (totalDiscountGiven / 100).toLocaleString("en-IN");

  return (
    <div className="space-y-6">
      {/* Referral Code Card */}
      <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-zinc-900 p-6">
        <p className="text-sm text-zinc-400 mb-2">Your Referral Code</p>
        <div className="flex items-center gap-3">
          <span className="text-3xl font-bold tracking-widest text-emerald-400 font-mono">
            {referralCode}
          </span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
            aria-label="Copy referral code"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy
              </>
            )}
          </button>
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Share this code with friends. They get ₹100 off their first booking!
        </p>
      </div>

      {/* Share Buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={handleShare}
          className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 px-4 py-3 text-sm font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
        >
          <Share2 className="h-4 w-4" />
          Share Link
        </button>
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 rounded-xl border border-green-600/30 bg-green-600/10 px-4 py-3 text-sm font-medium text-green-400 hover:bg-green-600/20 transition-colors"
        >
          {/* WhatsApp icon via text/svg */}
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
          </svg>
          WhatsApp
        </a>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center gap-2 text-zinc-500 mb-2">
            <Users className="h-4 w-4" />
            <span className="text-xs">Friends Joined</span>
          </div>
          <p className="text-2xl font-bold text-white">{totalReferrals}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center gap-2 text-zinc-500 mb-2">
            <Gift className="h-4 w-4" />
            <span className="text-xs">Discounts Given</span>
          </div>
          <p className="text-2xl font-bold text-emerald-400">
            ₹{earnedInRupees}
          </p>
        </div>
      </div>

      {/* How it Works */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
        <h3 className="text-sm font-medium text-zinc-500 uppercase tracking-wider">
          How it Works
        </h3>
        <div className="space-y-3">
          {[
            { step: "1", text: "Share your referral code with friends" },
            {
              step: "2",
              text: "Friend uses your code on their first booking",
            },
            { step: "3", text: "They get ₹100 off — it's that simple!" },
          ].map(({ step, text }) => (
            <div key={step} className="flex items-center gap-3">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-400">
                {step}
              </div>
              <p className="text-sm text-zinc-300">{text}</p>
              {step !== "3" && (
                <ArrowRight className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-zinc-600" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
