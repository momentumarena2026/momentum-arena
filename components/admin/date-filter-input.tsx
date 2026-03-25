"use client";

import { useRouter } from "next/navigation";

export function DateFilterInput({
  currentDate,
  status,
  sport,
}: {
  currentDate: string;
  status: string;
  sport: string;
}) {
  const router = useRouter();

  return (
    <input
      type="date"
      defaultValue={currentDate}
      className="rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 focus:border-emerald-500 focus:outline-none"
      onChange={(e) => {
        if (e.target.value) {
          const qs = new URLSearchParams();
          if (status) qs.set("status", status);
          if (sport) qs.set("sport", sport);
          qs.set("date", e.target.value);
          router.push(`/admin/bookings?${qs.toString()}`);
        }
      }}
    />
  );
}
