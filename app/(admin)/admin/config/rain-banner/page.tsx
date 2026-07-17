import { getRainBannerConfig } from "@/actions/admin-arena-settings";
import { RainBannerEditor } from "./rain-banner-editor";

/**
 * Web & App Config → Rain Banner. Moved out of /admin/pricing so every
 * customer-facing display toggle lives under one sidebar group.
 */
export default async function AdminRainBannerPage() {
  const rainBanner = await getRainBannerConfig();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Rain Banner</h1>
        <p className="mt-1 text-zinc-400">
          The weather-aware &ldquo;Rain doesn&apos;t slow us down&rdquo; strip
          on the homepage and booking page — web and app.
        </p>
      </div>
      <RainBannerEditor
        initialMode={rainBanner.mode}
        initialText={rainBanner.text}
      />
    </div>
  );
}
