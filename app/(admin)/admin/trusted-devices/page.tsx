import { getTrustedDevices } from "@/actions/admin-trusted-devices";
import { TrustedDevicesManager } from "./trusted-devices-manager";

export default async function AdminTrustedDevicesPage() {
  const devices = await getTrustedDevices();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Trusted Devices</h1>
        <p className="mt-1 text-zinc-400">
          Only these devices can open the hidden admin entry in the app (5
          taps on the version number). On an unregistered device, tapping the
          version 12 times reveals its device ID — paste it here. Devices
          also register themselves automatically after a successful admin
          login.
        </p>
      </div>

      <TrustedDevicesManager
        devices={devices.map((d) => ({
          id: d.id,
          deviceId: d.deviceId,
          label: d.label,
          platform: d.platform,
          source: d.source,
          createdAt: d.createdAt.toISOString(),
          lastSeenAt: d.lastSeenAt.toISOString(),
        }))}
      />
    </div>
  );
}
