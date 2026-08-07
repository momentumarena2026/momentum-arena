import { headers } from "next/headers";
import { StoreBadgeLink } from "@/components/store-badge-link";
import { isDownloadAppBannerEnabled } from "@/actions/admin-download-app-banner";
import {
  APP_STORE_URL,
  PLAY_STORE_URL,
  devicePlatform,
  type DevicePlatform,
} from "@/lib/app-store-links";

/**
 * "Get the app" store links.
 *
 * Which badges show is decided from the User-Agent on the server: an
 * iPhone sees only the App Store, an Android phone only Play, and desktop
 * sees both. Offering an Android user a link they can't use is noise, and
 * resolving it after hydration would flicker the very element we want
 * them to click.
 *
 * `variant="icon"` is the compact header form (glyph only, with an
 * accessible label); `variant="full"` is the footer form with the
 * familiar two-line badge wording.
 */

function AppleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 384 512" aria-hidden="true" className={className} fill="currentColor">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}

function PlayGlyph({ className }: { className?: string }) {
  // Google Play's four-colour triangle. Drawn rather than imported so the
  // header has no extra network request on first paint.
  return (
    <svg viewBox="0 0 512 512" aria-hidden="true" className={className}>
      <path fill="#00D2FF" d="M47.6 41.2C41.9 47.2 38.6 56.5 38.6 68.5v375c0 12 3.3 21.3 9 27.3l1.3 1.2 210.1-210.1v-5L48.9 46.8l-1.3-5.6z" />
      <path fill="#FFCE00" d="M328.9 331.1l-70-70v-5l70-70 1.6.9 82.9 47.1c23.7 13.4 23.7 35.4 0 48.9l-82.9 47.1-1.6 1z" />
      <path fill="#FF3A44" d="M330.5 330.1L258.9 258.5 47.6 470.9c7.8 8.3 20.7 9.3 35.3 1L330.5 330.1z" />
      <path fill="#00F076" d="M330.5 186.9L82.9 46.1c-14.6-8.3-27.5-7.3-35.3 1l211.3 211.4 71.6-71.6z" />
    </svg>
  );
}

interface Props {
  variant?: "icon" | "full";
  /** Where this badge sits, so the download funnel can attribute the tap.
   *  Defaults to "other" rather than guessing — an unlabelled tap is
   *  better than one filed under the wrong surface. */
  placement?: "header" | "footer" | "sticky_bar" | "other";
  /** Tighter full badge for the sticky app bar. A CSS `scale` looked right
   *  but doesn't shrink the LAYOUT box, so the badge kept reserving its
   *  full width and squeezed the copy beside it into an ellipsis. */
  compact?: boolean;
  className?: string;
  /** Override the detected platform. Only for previewing both states. */
  platform?: DevicePlatform;
}

export async function StoreBadges({
  variant = "full",
  className,
  platform,
  compact = false,
  placement = "other",
}: Props) {
  // Gated here rather than at each call site: three surfaces render this,
  // and a switch that only silenced two of them would read as a bug.
  if (!(await isDownloadAppBannerEnabled())) return null;

  const resolved =
    platform ?? devicePlatform((await headers()).get("user-agent"));

  const showApple = resolved === "ios" || resolved === "desktop";
  const showPlay = resolved === "android" || resolved === "desktop";

  if (variant === "icon") {
    return (
      <div className={`flex items-center gap-1.5 ${className ?? ""}`}>
        {showApple && (
          <StoreBadgeLink
            href={APP_STORE_URL}
            store="ios"
            placement={placement}
            ariaLabel="Download Momentum Arena on the App Store"
            title="Download on the App Store"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
          >
            <AppleGlyph className="h-4 w-4" />
          </StoreBadgeLink>
        )}
        {showPlay && (
          <StoreBadgeLink
            href={PLAY_STORE_URL}
            store="android"
            placement={placement}
            ariaLabel="Get Momentum Arena on Google Play"
            title="Get it on Google Play"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-700 transition-colors hover:border-zinc-500"
          >
            <PlayGlyph className="h-4 w-4" />
          </StoreBadgeLink>
        )}
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className ?? ""}`}>
      {showApple && (
        <StoreBadgeLink
          href={APP_STORE_URL}
          store="ios"
          placement={placement}
          ariaLabel="Download Momentum Arena on the App Store"
          className={`flex items-center rounded-xl border border-zinc-700 bg-zinc-900 transition-colors hover:border-zinc-500 hover:bg-zinc-800 ${compact ? "gap-2 px-2.5 py-1.5" : "gap-3 px-4 py-2.5"}`}
        >
          <AppleGlyph className={`${compact ? "h-4 w-4" : "h-6 w-6"} text-white`} />
          <span className="leading-tight">
            <span className={`block uppercase tracking-wide text-zinc-400 ${compact ? "text-[8px]" : "text-[10px]"}`}>
              Download on the
            </span>
            <span className={`block font-semibold text-white ${compact ? "text-[11px]" : "text-sm"}`}>App Store</span>
          </span>
        </StoreBadgeLink>
      )}
      {showPlay && (
        <StoreBadgeLink
          href={PLAY_STORE_URL}
          store="android"
          placement={placement}
          ariaLabel="Get Momentum Arena on Google Play"
          className={`flex items-center rounded-xl border border-zinc-700 bg-zinc-900 transition-colors hover:border-zinc-500 hover:bg-zinc-800 ${compact ? "gap-2 px-2.5 py-1.5" : "gap-3 px-4 py-2.5"}`}
        >
          <PlayGlyph className={compact ? "h-4 w-4" : "h-6 w-6"} />
          <span className="leading-tight">
            <span className={`block uppercase tracking-wide text-zinc-400 ${compact ? "text-[8px]" : "text-[10px]"}`}>
              Get it on
            </span>
            <span className={`block font-semibold text-white ${compact ? "text-[11px]" : "text-sm"}`}>Google Play</span>
          </span>
        </StoreBadgeLink>
      )}
    </div>
  );
}
