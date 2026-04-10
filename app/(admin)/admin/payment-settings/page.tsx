import { getPaymentGatewayConfig } from "@/actions/admin-payment-settings";
import { PaymentGatewayToggle } from "./gateway-toggle";

export default async function PaymentSettingsPage() {
  const config = await getPaymentGatewayConfig();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Payment Settings</h1>
        <p className="mt-1 text-zinc-400">
          Configure the active payment gateway for customer checkouts
        </p>
      </div>
      <PaymentGatewayToggle activeGateway={config.activeGateway} />
    </div>
  );
}
