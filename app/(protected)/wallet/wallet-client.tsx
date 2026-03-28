"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatPrice } from "@/lib/pricing";
import { topUpWallet, confirmWalletTopUp } from "@/actions/wallet";
import { WalletTxType } from "@prisma/client";
import {
  Wallet,
  ArrowUpCircle,
  ArrowDownCircle,
  Plus,
  Loader2,
  X,
  TrendingUp,
} from "lucide-react";

interface Transaction {
  id: string;
  type: WalletTxType;
  amountPaise: number;
  description: string;
  refBookingId: string | null;
  createdAt: string;
}

interface WalletClientProps {
  initialBalance: number;
  initialTransactions: Transaction[];
  userName: string;
  userEmail: string;
  userPhone: string;
}

const TX_ICONS: Record<WalletTxType, { icon: typeof ArrowUpCircle; color: string; label: string }> = {
  CREDIT_REFUND: { icon: ArrowUpCircle, color: "text-emerald-400", label: "Refund" },
  CREDIT_TOPUP: { icon: TrendingUp, color: "text-blue-400", label: "Top-up" },
  CREDIT_ADMIN: { icon: ArrowUpCircle, color: "text-purple-400", label: "Admin Credit" },
  DEBIT_BOOKING: { icon: ArrowDownCircle, color: "text-red-400", label: "Booking" },
  DEBIT_CAFE: { icon: ArrowDownCircle, color: "text-orange-400", label: "Cafe" },
};

const TOP_UP_AMOUNTS = [10000, 20000, 50000, 100000]; // in paise

export function WalletClient({
  initialBalance,
  initialTransactions,
  userName,
  userEmail,
  userPhone,
}: WalletClientProps) {
  const router = useRouter();
  const [balance, setBalance] = useState(initialBalance);
  const [transactions] = useState<Transaction[]>(initialTransactions);
  const [showTopUp, setShowTopUp] = useState(false);
  const [customAmount, setCustomAmount] = useState("");
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getTopUpAmount = (): number => {
    if (selectedAmount) return selectedAmount;
    const parsed = parseFloat(customAmount);
    if (!isNaN(parsed) && parsed > 0) return Math.round(parsed * 100);
    return 0;
  };

  const handleTopUp = async () => {
    const amount = getTopUpAmount();
    if (amount < 10000) {
      setError("Minimum top-up amount is ₹100");
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const result = await topUpWallet(amount);

      if (!result.success) {
        setError(result.error || "Failed to initiate top-up");
        return;
      }

      // Load Razorpay
      const options = {
        key: result.razorpayKeyId!,
        amount: result.amount!,
        currency: "INR",
        name: "Momentum Arena",
        description: "Wallet Top-up",
        order_id: result.razorpayOrderId!,
        handler: async function (response: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) {
          const confirmResult = await confirmWalletTopUp(
            response.razorpay_order_id,
            response.razorpay_payment_id,
            amount
          );

          if (confirmResult.success) {
            setBalance((prev) => prev + amount);
            setShowTopUp(false);
            setCustomAmount("");
            setSelectedAmount(null);
            router.refresh();
          } else {
            setError("Payment successful but wallet update failed. Contact support.");
          }
        },
        prefill: { name: userName, email: userEmail, contact: userPhone },
        theme: { color: "#10b981" },
      };

      const razorpay = new (
        window as unknown as {
          Razorpay: new (opts: typeof options) => { open: () => void };
        }
      ).Razorpay(options);
      razorpay.open();
    } catch {
      setError("Something went wrong");
    } finally {
      setProcessing(false);
    }
  };

  const isCredit = (type: WalletTxType) =>
    type === "CREDIT_REFUND" || type === "CREDIT_TOPUP" || type === "CREDIT_ADMIN";

  return (
    <div className="space-y-6">
      {/* Balance Card */}
      <div className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-emerald-500/10 to-zinc-900 p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 text-zinc-400">
              <Wallet className="h-4 w-4" />
              <span className="text-sm">Available Balance</span>
            </div>
            <p className="mt-2 text-4xl font-bold text-white">
              {formatPrice(balance)}
            </p>
            <p className="mt-1 text-sm text-zinc-500">Momentum Wallet</p>
          </div>

          <button
            onClick={() => setShowTopUp(!showTopUp)}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Top Up
          </button>
        </div>
      </div>

      {/* Top Up Section */}
      {showTopUp && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-white">Add Money</h3>
            <button
              onClick={() => { setShowTopUp(false); setError(null); }}
              className="text-zinc-500 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Quick amounts */}
          <div className="grid grid-cols-4 gap-2">
            {TOP_UP_AMOUNTS.map((amt) => (
              <button
                key={amt}
                onClick={() => { setSelectedAmount(amt); setCustomAmount(""); }}
                className={`rounded-lg border py-2 text-sm font-medium transition-colors ${
                  selectedAmount === amt
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                    : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-600"
                }`}
              >
                ₹{amt / 100}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-zinc-800" />
            <span className="text-xs text-zinc-500">or enter amount</span>
            <div className="h-px flex-1 bg-zinc-800" />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-zinc-400">₹</span>
            <input
              type="number"
              value={customAmount}
              onChange={(e) => { setCustomAmount(e.target.value); setSelectedAmount(null); }}
              placeholder="Enter amount (min ₹100)"
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-white placeholder-zinc-500"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            onClick={handleTopUp}
            disabled={processing || getTopUpAmount() < 10000}
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {processing ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing...
              </span>
            ) : (
              `Add ${getTopUpAmount() >= 10000 ? formatPrice(getTopUpAmount()) : "Money"}`
            )}
          </button>
        </div>
      )}

      {/* Transaction History */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-zinc-500 uppercase tracking-wider">
          Transaction History
        </h2>

        {transactions.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
            <Wallet className="mx-auto h-10 w-10 text-zinc-600" />
            <p className="mt-3 text-sm text-zinc-400">No transactions yet</p>
            <p className="mt-1 text-xs text-zinc-500">
              Top up your wallet and start paying for bookings
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {transactions.map((tx) => {
              const credit = isCredit(tx.type);
              const txConfig = TX_ICONS[tx.type];
              const Icon = txConfig.icon;

              return (
                <div
                  key={tx.id}
                  className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-3.5"
                >
                  <div className="flex items-center gap-3">
                    <div className={`rounded-lg p-2 ${credit ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                      <Icon className={`h-4 w-4 ${txConfig.color}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{tx.description}</p>
                      <p className="text-xs text-zinc-500">
                        {txConfig.label} •{" "}
                        {new Date(tx.createdAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                  </div>
                  <span className={`text-sm font-semibold ${credit ? "text-emerald-400" : "text-red-400"}`}>
                    {credit ? "+" : "-"}{formatPrice(tx.amountPaise)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
