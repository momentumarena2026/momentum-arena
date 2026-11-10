import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { areCampsEnabled } from "@/lib/camps";

/** See app/passes/layout.tsx — this subtree inherited the root metadata too. */
export const metadata: Metadata = {
  title: "Coaching Camps | Momentum Arena Mathura",
  description:
    "Structured coaching camps at Momentum Arena, Mathura — cricket, football, pickleball and table tennis, on floodlit courts.",
};

// Every customer camps page carries the shared funnel header — same fix
// as /tournaments and /passes, which both used to render bare against
// the black background. The layout doubles as the module gate: when the
// admin switch is OFF the whole subtree 404s.
export default async function CampsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await areCampsEnabled())) notFound();
  return (
    <div className="min-h-screen bg-zinc-950">
      <SiteHeader active="camps" />
      {children}
    </div>
  );
}
