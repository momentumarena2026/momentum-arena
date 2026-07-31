import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  BellRing,
  CalendarCheck,
  Ticket,
  Users,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import {
  listNotifications,
  markAllNotificationsRead,
} from "@/lib/user-notifications";

export const dynamic = "force-dynamic";

// Type → icon + accent for the list rows. Unknown types fall back to the
// bell so new server-side types render without a client update.
const TYPE_ICON: Record<
  string,
  { Icon: typeof BellRing; cls: string; bg: string }
> = {
  PASS_MEMBER_ADDED: { Icon: Users, cls: "text-violet-400", bg: "bg-violet-500/15" },
  PASS_BOOKING: { Icon: Ticket, cls: "text-emerald-400", bg: "bg-emerald-500/15" },
  PASS_PURCHASED: { Icon: Ticket, cls: "text-emerald-400", bg: "bg-emerald-500/15" },
  BOOKING_CONFIRMED: { Icon: CalendarCheck, cls: "text-blue-400", bg: "bg-blue-500/15" },
  REWARDS: { Icon: Sparkles, cls: "text-amber-400", bg: "bg-amber-500/15" },
};

function timeAgo(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/**
 * "My Notifications" — every user-specific event (added to a pass,
 * pass-paid bookings, confirmations, …). Opening the page marks
 * everything read; unread rows are highlighted this one last time.
 */
export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/notifications");

  const items = await listNotifications(session.user.id);
  // Mark read AFTER capturing the list so this render still highlights
  // the fresh ones; the bell badge clears from the next navigation.
  await markAllNotificationsRead(session.user.id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-emerald-500/15 p-2.5">
          <BellRing className="h-5 w-5 text-emerald-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">My Notifications</h1>
          <p className="text-sm text-zinc-400">
            Pass activity, bookings and everything meant just for you.
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 py-16 text-center">
          <BellRing className="mx-auto h-8 w-8 text-zinc-700" />
          <p className="mt-3 text-sm text-zinc-500">
            Nothing yet — booking updates and pass activity will land here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((n) => {
            const t = TYPE_ICON[n.type] ?? {
              Icon: BellRing,
              cls: "text-zinc-400",
              bg: "bg-zinc-800",
            };
            const inner = (
              <div
                className={`flex items-start gap-3 rounded-xl border p-4 transition-colors ${
                  n.readAt
                    ? "border-zinc-800/70 bg-zinc-900/50"
                    : "border-emerald-500/25 bg-emerald-500/5"
                } ${n.link ? "hover:border-zinc-600" : ""}`}
              >
                <div className={`mt-0.5 rounded-lg p-2 ${t.bg}`}>
                  <t.Icon className={`h-4 w-4 ${t.cls}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-semibold text-white">{n.title}</p>
                    <span className="shrink-0 text-[11px] text-zinc-500">
                      {timeAgo(n.createdAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm leading-relaxed text-zinc-400">
                    {n.body}
                  </p>
                </div>
                {!n.readAt && (
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                )}
              </div>
            );
            return n.link ? (
              <Link key={n.id} href={n.link} className="block">
                {inner}
              </Link>
            ) : (
              <div key={n.id}>{inner}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
