import { getRazorpayOverview } from "@/actions/admin-razorpay";
import { RazorpayDashboard } from "./razorpay-dashboard";

export default async function AdminRazorpayPage() {
  const overview = await getRazorpayOverview();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Razorpay Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Payment gateway data from Razorpay
        </p>
      </div>
      <RazorpayDashboard initialOverview={overview} />
    </div>
  );
}
