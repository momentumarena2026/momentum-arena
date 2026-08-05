import { StoreBadges } from "@/components/store-badges";
import { isDownloadAppBannerEnabled } from "@/actions/admin-download-app-banner";

/**
 * "Get the app" sticky strip, phones only.
 *
 * Sits directly under the header and stays there as the page scrolls, so
 * the pitch is in front of a mobile-web visitor the whole session rather
 * than only when they reach the footer.
 *
 * `top` exists because the two headers behave differently: the homepage
 * renders its own `fixed` nav (h-20), so the strip has to park at 5rem to
 * land under it, while SiteHeader is in normal flow and scrolls away — a
 * strip below it sticks correctly at 0. Passing the offset beats guessing
 * one value that's wrong on half the site.
 *
 * Desktop is excluded on purpose: a desktop visitor can't install a phone
 * app from that browser, so the footer badges are the right (and only)
 * placement there.
 */
export async function AppCtaBar({
  top = "top-0",
}: {
  /** "none" when the caller already wraps header+strip in one sticky
   *  block — the strip must not re-stick inside its own sticky parent. */
  top?: "top-0" | "fixed-20" | "none";
}) {
  // Own check: the strip is a green bar with its own copy, so hiding
  // only the badge inside it would leave an empty coloured band.
  if (!(await isDownloadAppBannerEnabled())) return null;

  return (
    <div
      className={`${
        top === "none"
          ? ""
          : top === "fixed-20"
            ? // Homepage: its nav is `fixed`, and an ancestor's overflow was
              // killing `sticky` outright (measured: the strip scrolled away
              // with the page). Fixed matches the nav and can't be broken by
              // an ancestor.
              "fixed left-0 right-0 top-20 z-40"
            : "sticky top-0 z-40"
      } border-b border-emerald-400/30 bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-600 shadow-lg shadow-emerald-900/40 md:hidden`}
    >
      {/* overflow-hidden is load-bearing: the full badge is wide, and on a
          narrow phone a stray pixel of overflow would give the whole page a
          horizontal scrollbar. */}
      <div className="flex items-center justify-between gap-2 overflow-hidden px-3 py-2">
        <div className="min-w-0 flex-1">
          {/* nowrap on the headline — "Get the app." breaking across three
              lines was what made the first version look broken. */}
          <p className="whitespace-nowrap text-[13px] font-extrabold leading-tight tracking-tight text-white">
            Get the app.
          </p>
          <p className="truncate text-[11px] font-semibold leading-tight text-emerald-50">
            Smoother. Faster. Better.
          </p>
        </div>
        {/* The footer's full badge in its compact size — a real size, not a
            CSS scale, so it actually gives the copy its width back. */}
        <StoreBadges variant="full" compact className="shrink-0" />
      </div>
    </div>
  );
}
