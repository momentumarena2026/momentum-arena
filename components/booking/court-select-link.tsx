"use client";

import Link from "next/link";

type Props = {
  href: string;
  sport: string;
  courtConfigId?: string;
  mode?: "medium" | "bowling";
  label: string;
  size?: string;
  className?: string;
  children: React.ReactNode;
};

/** Link that fire-and-forgets a court-selection audit log on tap. */
export function CourtSelectLink({
  href,
  sport,
  courtConfigId,
  mode,
  label,
  size,
  className,
  children,
}: Props) {
  function logSelection() {
    void fetch("/api/booking/select-court", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sport, courtConfigId, mode, label, size }),
    });
  }

  return (
    <Link href={href} className={className} onClick={logSelection}>
      {children}
    </Link>
  );
}
