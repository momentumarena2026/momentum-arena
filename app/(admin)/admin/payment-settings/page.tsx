import { getPaymentGatewayConfig } from "@/actions/admin-payment-settings";
import { PaymentGatewayToggle } from "./gateway-toggle";
import { PaymentMethodToggles } from "./method-toggles";

export default async function PaymentSettingsPage() {
  const config = await getPaymentGatewayConfig();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Payment Settings</h1>
        <p className="mt-1 text-zinc-400">
          Configure which payment methods are offered at checkout and which
          gateway processes online payments.
        </p>
      </div>

      <PaymentMethodToggles
        onlineEnabled={config.onlineEnabled}
        upiQrEnabled={config.upiQrEnabled}
        advanceEnabled={config.advanceEnabled}
      />

      <PaymentGatewayToggle activeGateway={config.activeGateway} />
    </div>
  );
}
