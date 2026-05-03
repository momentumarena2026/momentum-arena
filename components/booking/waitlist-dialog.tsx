"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
// useEffect retained for the keydown listener; the joined-state reset
// uses the render-time pattern so it doesn't trip set-state-in-effect.
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Bell, BellRing, X } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { LoginModal } from "@/components/login-modal";
import { joinWaitlist } from "@/actions/waitlist";
import {
  trackSlotUnavailableTap,
  trackWaitlistJoinFailed,
  trackWaitlistJoined,
} from "@/lib/analytics";
import { formatHourRangeCompact } from "@/lib/court-config";
import { cn } from "@/lib/utils";

interface WaitlistDialogProps {
  isOpen: boolean;
  onClose: () => void;
  courtConfigId: string;
  courtLabel: string;
  sport: string;
  date: string; // YYYY-MM-DD
  hour: number;
}

export function WaitlistDialog({
  isOpen,
  onClose,
  courtConfigId,
  courtLabel,
  sport,
  date,
  hour,
}: WaitlistDialogProps) {
  const { data: session, status: sessionStatus } = useSession();
  const [showLogin, setShowLogin] = useState(false);
  const [joined, setJoined] = useState(false);
  const [pending, startTransition] = useTransition();

  // Reset internal state every time the dialog re-opens for a fresh
  // slot. Render-time check (vs useEffect+setState) avoids the
  // "set state in effect" lint and matches React's canonical
  // "deriving-state-from-props" pattern.
  const slotKey = `${courtConfigId}-${date}-${hour}-${isOpen}`;
  const [lastSlotKey, setLastSlotKey] = useState(slotKey);
  if (slotKey !== lastSlotKey) {
    setLastSlotKey(slotKey);
    setJoined(false);
    // Fire the funnel-entry event the moment the dialog opens for a
    // particular slot — drives the "tapped → joined" conversion rate
    // in /admin/analytics/funnels. We do this here (not in the
    // parent slot grid) so we capture EVERY open including same-slot
    // re-opens; the join event below pairs it 1:1.
    if (isOpen) {
      trackSlotUnavailableTap(courtConfigId, hour, date, sport);
    }
  }

  const handleEsc = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen, handleEsc]);

  const handleNotifyMe = () => {
    startTransition(async () => {
      const res = await joinWaitlist({
        courtConfigId,
        date,
        startHour: hour,
        endHour: hour + 1,
      });
      if (res.success) {
        setJoined(true);
        trackWaitlistJoined(courtConfigId, hour, date, sport);
        toast.success("You're on the waitlist", {
          description: "We'll ping you on push and SMS if it opens up.",
        });
      } else {
        trackWaitlistJoinFailed(
          courtConfigId,
          hour,
          res.error || "unknown",
        );
        toast.error(res.error || "Couldn't join the waitlist");
      }
    });
  };

  if (!isOpen) return null;

  const isLoggedIn = sessionStatus === "authenticated" && !!session?.user?.id;
  const friendlyDate = formatFriendlyDate(date);

  const dialog = (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center p-4"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-full bg-amber-500/15 p-2.5">
            <Bell className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">
              This slot is booked
            </h2>
            <p className="text-sm text-zinc-400">
              Get notified if it opens up
            </p>
          </div>
        </div>

        <div className="mb-5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm">
          <div className="grid grid-cols-3 gap-y-2 text-zinc-300">
            <span className="text-zinc-500">Sport</span>
            <span className="col-span-2 font-medium text-white">
              {capitalise(sport)}
            </span>
            <span className="text-zinc-500">Court</span>
            <span className="col-span-2 font-medium text-white">{courtLabel}</span>
            <span className="text-zinc-500">Date</span>
            <span className="col-span-2 font-medium text-white">
              {friendlyDate}
            </span>
            <span className="text-zinc-500">Time</span>
            <span className="col-span-2 font-medium text-white">
              {formatHourRangeCompact(hour)}
            </span>
          </div>
        </div>

        {joined ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
              <div className="flex items-start gap-2">
                <BellRing className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <div>
                  <p className="font-medium text-emerald-200">
                    You&apos;re on the waitlist
                  </p>
                  <p className="mt-1 text-emerald-300/80">
                    We&apos;ll send a push and SMS the moment this slot opens
                    up. First to book wins.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Link
                href="/waitlist"
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "flex-1",
                )}
              >
                View my waitlist
              </Link>
              <Button onClick={onClose} className="flex-1">
                Done
              </Button>
            </div>
          </div>
        ) : isLoggedIn ? (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">
              We&apos;ll alert you on <strong className="text-zinc-200">push</strong>{" "}
              and <strong className="text-zinc-200">SMS</strong> the moment this
              slot is freed by a cancellation. Slots are first-come-first-
              served, so book quickly.
            </p>
            <Button
              onClick={handleNotifyMe}
              disabled={pending}
              className="w-full bg-amber-500 text-black hover:bg-amber-400"
            >
              {pending ? "Joining…" : "Notify me when it opens up"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">
              Sign in once and we&apos;ll alert you whenever a slot you&apos;re
              waiting for opens up — push and SMS, both in one tap.
            </p>
            <Button
              onClick={() => setShowLogin(true)}
              className="w-full bg-amber-500 text-black hover:bg-amber-400"
            >
              Sign in to join the waitlist
            </Button>
          </div>
        )}
      </div>

      <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(dialog, document.body);
}

function capitalise(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function formatFriendlyDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
