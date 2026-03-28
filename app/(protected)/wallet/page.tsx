import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getWallet } from "@/actions/wallet";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { WalletClient } from "./wallet-client";

export default async function WalletPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const result = await getWallet();

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
        <h1 className="text-2xl font-bold text-white">Momentum Wallet</h1>
        <p className="mt-1 text-zinc-400">Top up and pay for bookings instantly</p>
      </div>

      <WalletClient
        initialBalance={result.wallet?.balancePaise ?? 0}
        initialTransactions={
          result.wallet?.transactions.map((t) => ({
            ...t,
            createdAt: t.createdAt.toISOString(),
          })) ?? []
        }
        userName={session.user.name || ""}
        userEmail={session.user.email || ""}
        userPhone={(session.user as { phone?: string }).phone || ""}
      />
    </div>
  );
}
