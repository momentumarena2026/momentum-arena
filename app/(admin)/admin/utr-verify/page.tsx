import { getPendingUtrPayments } from "@/actions/upi-payment";
import { UtrVerifyDashboard } from "./utr-verify-dashboard";

export default async function UtrVerifyPage() {
  const data = await getPendingUtrPayments();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">UTR Verification</h1>
        <p className="mt-1 text-zinc-400">
          Verify UPI QR payments submitted by customers
        </p>
      </div>
      <UtrVerifyDashboard initialData={data} />
    </div>
  );
}
