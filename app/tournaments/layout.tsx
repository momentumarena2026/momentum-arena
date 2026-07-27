import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { areTournamentsEnabled } from "@/lib/tournaments";

// Every customer tournament page carries the shared funnel header (same
// fix as /passes — pages here used to render bare against the black
// background). The layout is also the module gate: when the admin switch
// is OFF the whole subtree 404s. The scorer console (/score/[code]) lives
// outside this subtree on purpose — field scorers keep a chromeless page
// and are unaffected by the public switch.
export default async function TournamentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await areTournamentsEnabled())) notFound();
  return (
    <div className="min-h-screen bg-zinc-950">
      <SiteHeader active="tournaments" />
      {children}
    </div>
  );
}
