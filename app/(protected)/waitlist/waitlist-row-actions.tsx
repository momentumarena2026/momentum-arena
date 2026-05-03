"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cancelWaitlist } from "@/actions/waitlist";
import { trackWaitlistCancelled, trackWaitlistRowBookNow } from "@/lib/analytics";
import { cn } from "@/lib/utils";

export function WaitlistRowActions({
  waitlistId,
  courtConfigId,
  sport,
  isNotified,
}: {
  waitlistId: string;
  courtConfigId: string;
  sport: string;
  isNotified: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const handleCancel = () => {
    start(async () => {
      const res = await cancelWaitlist(waitlistId);
      if (res.success) {
        trackWaitlistCancelled(waitlistId);
        toast.success("Removed from waitlist");
        router.refresh();
      } else {
        toast.error(res.error || "Couldn't remove");
      }
    });
  };

  // sport is uppercase enum (e.g. CRICKET); the booking flow URL is
  // lowercase. Same convention used in /book/[sport]/[configId].
  const bookHref = `/book/${sport.toLowerCase()}/${courtConfigId}`;

  return (
    <div className="flex flex-shrink-0 flex-col items-stretch gap-2 sm:flex-row">
      {isNotified && (
        <Link
          href={bookHref}
          onClick={() => trackWaitlistRowBookNow(waitlistId)}
          className={cn(
            buttonVariants(),
            "bg-emerald-600 text-white hover:bg-emerald-700",
          )}
        >
          Book now
        </Link>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={handleCancel}
        disabled={pending}
        className="text-zinc-400 hover:bg-red-500/10 hover:text-red-300"
      >
        <Trash2 className="mr-1 h-4 w-4" />
        {pending ? "Removing…" : "Remove"}
      </Button>
    </div>
  );
}
