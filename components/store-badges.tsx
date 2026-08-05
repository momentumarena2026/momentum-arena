import Image from "next/image";
import { headers } from "next/headers";
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
 * Both variants render the OFFICIAL badge artwork — `variant="icon"` is
 * simply a smaller instance for the header, `variant="full"` the footer
 * size. Nothing is cropped or redrawn: Apple's and Google's guidelines
 * both forbid altering the badge, and on mobile only one of the two ever
 * shows, so a full badge fits the header slot.
 */

interface Props {
  variant?: "icon" | "full";
  className?: string;
  /** Override the detected platform. Only for previewing both states. */
  platform?: DevicePlatform;
}

export async function StoreBadges({ variant = "full", className, platform }: Props) {
  const resolved =
    platform ?? devicePlatform((await headers()).get("user-agent"));

  const showApple = resolved === "ios" || resolved === "desktop";
  const showPlay = resolved === "android" || resolved === "desktop";

  // Shared by both variants: the badges don't match each other — Apple's
  // is black-on-black, Google's white-on-white — so on our near-black
  // surfaces the Apple one would vanish. Both sit on the same white chip,
  // which gives Apple the light background its guidelines ask for and
  // doubles as the required clear space. The artwork itself is untouched.
  const chip =
    "flex items-center rounded-lg bg-white transition-transform hover:scale-[1.03]";

  if (variant === "icon") {
    return (
      <div className={`flex items-center gap-2 ${className ?? ""}`}>
        {showApple && (
          <a
            href={APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Download Momentum Arena on the App Store"
            className={`${chip} h-9 px-2`}
          >
            <Image
              src="/store/app-store.webp"
              alt="Download on the App Store"
              width={540}
              height={189}
              // Above the fold — without this next/image lazy-loads it and
              // the header shows an empty white chip until it pops in.
              priority
              className="h-5 w-auto"
            />
          </a>
        )}
        {showPlay && (
          <a
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Get Momentum Arena on Google Play"
            className={`${chip} h-9 px-2`}
          >
            <Image
              src="/store/google-play.webp"
              alt="Get it on Google Play"
              width={540}
              height={177}
              priority
              className="h-5 w-auto"
            />
          </a>
        )}
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className ?? ""}`}>
      {showApple && (
        <a
          href={APP_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Download Momentum Arena on the App Store"
          className={`${chip} h-12 px-3`}
        >
          <Image
            src="/store/app-store.webp"
            alt="Download on the App Store"
            width={540}
            height={189}
            className="h-7 w-auto"
          />
        </a>
      )}
      {showPlay && (
        <a
          href={PLAY_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Get Momentum Arena on Google Play"
          className={`${chip} h-12 px-3`}
        >
          <Image
            src="/store/google-play.webp"
            alt="Get it on Google Play"
            width={540}
            height={177}
            className="h-7 w-auto"
          />
        </a>
      )}
    </div>
  );
}
