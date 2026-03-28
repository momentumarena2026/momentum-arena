import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getReferralStats } from "@/actions/referral";
import { ReferralClient } from "./referral-client";
import Link from "next/link";
import { ArrowLeft, Gift } from "lucide-react";

export default async function ReferralPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const stats = await getReferralStats();
  if (!stats) redirect("/login");

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <Link
          href="/dashboard"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20">
            <Gift className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Refer &amp; Earn</h1>
            <p className="text-sm text-zinc-400">
              Invite friends and help them save on their first booking
            </p>
          </div>
        </div>
      </div>

      <ReferralClient
        referralCode={stats.referralCode}
        totalReferrals={stats.totalReferrals}
        totalDiscountGiven={stats.totalDiscountGiven}
      />
    </div>
  );
}
