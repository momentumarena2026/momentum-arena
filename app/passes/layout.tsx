import { SiteHeader } from "@/components/site-header";

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
