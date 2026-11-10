import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";

/**
 * Without this the whole /passes subtree inherited the ROOT metadata, so
 * every pass page told Google it was the home page — same title, same
 * description. A section with no identity of its own is a section Google
 * has no reason to surface separately.
 */
export const metadata: Metadata = {
  title: "Monthly Passes | Momentum Arena Mathura",
  description:
    "Buy bulk hours on cricket, football, pickleball or table tennis at a discounted hourly rate, then spend them at checkout instead of paying. Shareable with your squad.",
};

/**
 * Passes funnel layout — just the shared top nav above the page. The
 * PassesClient renders its own full-bleed hero + min-h-screen bg, so
 * (unlike /book and /shop) we deliberately DON'T wrap children in a
 * width-constrained <main>; that would box in the hero.
 */
export default function PassesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader active="passes" />
      {children}
    </>
  );
}
