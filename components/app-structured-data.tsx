import {
  ANDROID_PACKAGE,
  APPLE_APP_ID,
  APP_STORE_URL,
  PLAY_STORE_URL,
} from "@/lib/app-store-links";

/**
 * MobileApplication structured data — one entry per store listing.
 *
 * The site already described the venue (LocalBusiness / Organization) but
 * said nothing machine-readable about the apps existing. This is the
 * signal search engines read to associate momentumarena.com with the two
 * listings, and what lets an app appear alongside the site rather than
 * only being findable by searching the stores directly.
 *
 * `offers` at price 0 is required, not decorative: without a price a
 * MobileApplication entry is treated as incomplete and generally ignored.
 * The apps are free — booking is paid inside them, which is not the same
 * thing as a paid download.
 *
 * Deliberately NOT claiming aggregateRating. Star ratings in structured
 * data must reflect real, visible reviews; inventing them is exactly the
 * kind of thing that earns a manual penalty.
 */
export function AppStructuredData() {
  const shared = {
    "@context": "https://schema.org",
    "@type": "MobileApplication",
    applicationCategory: "SportsApplication",
    applicationSubCategory: "Sports venue booking",
    description:
      "Book cricket, football and pickleball courts at Momentum Arena Mathura. Manage passes, order from the cafe, join tournaments and camps, and follow live match scores.",
    publisher: {
      "@type": "Organization",
      name: "Momentum Arena",
      url: "https://momentumarena.com",
    },
    inLanguage: "en-IN",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "INR",
    },
  };

  const ios = {
    ...shared,
    name: "Momentum Arena",
    operatingSystem: "iOS",
    installUrl: APP_STORE_URL,
    downloadUrl: APP_STORE_URL,
    url: APP_STORE_URL,
    identifier: APPLE_APP_ID,
    screenshot: "https://momentumarena.com/og-cover.jpg",
  };

  const android = {
    ...shared,
    name: "Momentum Arena",
    operatingSystem: "ANDROID",
    installUrl: PLAY_STORE_URL,
    downloadUrl: PLAY_STORE_URL,
    url: PLAY_STORE_URL,
    identifier: ANDROID_PACKAGE,
    screenshot: "https://momentumarena.com/og-cover.jpg",
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ios) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(android) }}
      />
    </>
  );
}
