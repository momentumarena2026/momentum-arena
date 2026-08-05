import { isDownloadAppBannerEnabled } from "@/actions/admin-download-app-banner";
import { DownloadAppBannerToggle } from "./toggle";

export const dynamic = "force-dynamic";

export default async function DownloadAppBannerPage() {
  const enabled = await isDownloadAppBannerEnabled();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Download App Banner</h1>
        <p className="mt-1 text-zinc-400">
          One switch for every &ldquo;get the app&rdquo; prompt on the website.
        </p>
      </div>

      <DownloadAppBannerToggle initial={enabled} />

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          What this controls
        </p>
        <ul className="mt-2 space-y-1.5 text-sm text-zinc-300">
          <li>
            • <span className="text-white">Sticky strip</span> — the green
            &ldquo;Get the app&rdquo; bar pinned under the header on phones.
          </li>
          <li>
            • <span className="text-white">Header icon</span> — the store icon
            beside the notification bell on phones.
          </li>
          <li>
            • <span className="text-white">Footer section</span> — the
            &ldquo;Get the Momentum Arena app&rdquo; row with both badges.
          </li>
        </ul>
        <p className="mt-3 text-xs text-zinc-500">
          Off by default. Desktop only ever sees the footer section; phones show
          the store matching their device (App Store on iPhone, Play on Android).
          This does not affect the app itself or the SEO meta tags.
        </p>
      </div>
    </div>
  );
}
