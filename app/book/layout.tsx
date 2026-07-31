import { SiteHeader } from "@/components/site-header";
import { MinimalHeader } from "@/components/minimal-header";
import { PathSwitch } from "@/components/nav/path-switch";

export default function BookLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-black">
      {/* Payment screen stays distraction-free: logo only, no nav. */}
      <PathSwitch
        prefix="/book/checkout"
        match={<MinimalHeader />}
        otherwise={<SiteHeader active="sports" />}
      />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
