import {
  Bell,
  Smartphone,
  Apple,
  Users,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Send,
  Globe,
} from "lucide-react";
import {
  getPushStats,
  getRecentPushNotifications,
  getPushDevices,
} from "@/actions/admin-push";
import { BroadcastForm } from "./broadcast-form";
import { PruneStaleButton, DeleteDeviceButton } from "./maintenance-actions";

export default async function AdminPushPage() {
  const [stats, recent, deviceList] = await Promise.all([
    getPushStats(),
    getRecentPushNotifications(50),
    getPushDevices({ limit: 25 }),
  ]);

  const statCards = [
    {
      label: "Registered Devices",
      value: stats.totalDevices.toLocaleString(),
      hint: `${stats.activeUsers} unique user${stats.activeUsers === 1 ? "" : "s"}`,
      icon: Bell,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/20",
    },
    {
      label: "Android",
      value: stats.androidDevices.toLocaleString(),
      hint: `${pct(stats.androidDevices, stats.totalDevices)}% of fleet`,
      icon: Smartphone,
      color: "text-green-400",
      bg: "bg-green-500/10",
      border: "border-green-500/20",
    },
    {
      label: "iOS",
      value: stats.iosDevices.toLocaleString(),
      hint: `${pct(stats.iosDevices, stats.totalDevices)}% of fleet`,
      icon: Apple,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      border: "border-blue-500/20",
    },
    {
      label: "Sent (7d)",
      value: stats.sent7d.toLocaleString(),
      hint:
        stats.successRate7d === null
          ? "no attempts yet"
          : `${stats.successRate7d}% delivered`,
      icon: Send,
      color: "text-amber-300",
      bg: "bg-amber-500/10",
      border: "border-amber-500/20",
    },
    {
      label: "Sent (30d)",
      value: stats.sent30d.toLocaleString(),
      hint: `${stats.skipped7d} skipped this week (no devices)`,
      icon: Clock,
      color: "text-purple-300",
      bg: "bg-purple-500/10",
      border: "border-purple-500/20",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Push Notifications</h1>
          <p className="mt-1 text-sm text-zinc-500">
            FCM device registry, broadcast tooling and delivery audit log.
          </p>
        </div>
        <PruneStaleButton staleDevices={stats.staleDevices} />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className={`rounded-xl border ${stat.border} bg-zinc-900/50 p-4 space-y-2`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-500">{stat.label}</span>
                <div className={`rounded-lg ${stat.bg} p-1.5`}>
                  <Icon className={`h-3.5 w-3.5 ${stat.color}`} />
                </div>
              </div>
              <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
              <p className="text-[10px] text-zinc-600">{stat.hint}</p>
            </div>
          );
        })}
      </div>

      {/* Broadcast form */}
      <BroadcastForm
        initialReach={{
          all: stats.totalDevices,
          android: stats.androidDevices,
          ios: stats.iosDevices,
        }}
      />

      {/* Two-column layout for the two tables on desktop */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent notifications */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/80">
            <h2 className="text-sm font-semibold text-white">Recent push notifications</h2>
            <span className="text-[10px] text-zinc-500">last {recent.length}</span>
          </div>
          {recent.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-zinc-500">
              No push notifications yet. Send a broadcast or trigger a booking flow.
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800/50 max-h-[480px] overflow-auto">
              {recent.map((row) => (
                <li
                  key={row.id}
                  className="grid grid-cols-[auto_1fr_auto] gap-3 items-center px-4 py-2.5 hover:bg-zinc-800/40"
                >
                  <StatusDot status={row.status} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs text-white truncate">
                      <span className="truncate">
                        {row.bookingUserName ||
                          row.bookingUserPhone ||
                          row.bookingId.slice(-8)}
                      </span>
                      <span className="text-zinc-700">·</span>
                      <a
                        href={`/admin/bookings/${row.bookingId}`}
                        className="text-emerald-400 hover:underline text-[10px]"
                      >
                        booking #{row.bookingId.slice(-6)}
                      </a>
                    </div>
                    {row.error && (
                      <p className="text-[10px] text-red-400 truncate" title={row.error}>
                        error: {row.error}
                      </p>
                    )}
                  </div>
                  <span className="text-[10px] text-zinc-600 shrink-0">
                    {timeAgo(row.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Devices */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/80">
            <h2 className="text-sm font-semibold text-white">Registered devices</h2>
            <span className="text-[10px] text-zinc-500">
              showing {deviceList.devices.length} of {deviceList.total}
            </span>
          </div>
          {deviceList.devices.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-zinc-500">
              No devices registered yet.
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800/50 max-h-[480px] overflow-auto">
              {deviceList.devices.map((d) => (
                <li
                  key={d.id}
                  className="grid grid-cols-[auto_1fr_auto] gap-3 items-center px-4 py-2.5 hover:bg-zinc-800/40"
                >
                  <PlatformBadge platform={d.platform} />
                  <div className="min-w-0">
                    <p className="text-xs text-white truncate">
                      {d.userName || d.userPhone || d.userId.slice(-8)}
                    </p>
                    <p className="text-[10px] text-zinc-600 truncate font-mono">
                      {d.tokenPreview}
                      {d.appVersion && ` · v${d.appVersion}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-zinc-600" title={d.lastSeenAt.toString()}>
                      {timeAgo(d.lastSeenAt)}
                    </span>
                    <DeleteDeviceButton id={d.id} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  if (status === "sent") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400">
        <CheckCircle2 className="h-2.5 w-2.5" /> sent
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-red-400">
        <AlertTriangle className="h-2.5 w-2.5" /> failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800/50 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-500">
      {status}
    </span>
  );
}

function PlatformBadge({ platform }: { platform: string }) {
  if (platform === "android") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-green-500/30 bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-400">
        <Smartphone className="h-3 w-3" /> Android
      </span>
    );
  }
  if (platform === "ios") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
        <Apple className="h-3 w-3" /> iOS
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800/50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
      <Globe className="h-3 w-3" /> {platform}
    </span>
  );
}

function pct(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 100);
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
