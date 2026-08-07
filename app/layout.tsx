import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";
import { ANDROID_PACKAGE, APPLE_APP_ID } from "@/lib/app-store-links";
import { Michroma } from "next/font/google";
import { SessionProvider } from "next-auth/react";

const michroma = Michroma({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-michroma",
});
import { auth } from "@/lib/auth";
import { ChatWidgetWrapper } from "@/components/chatbot/chat-widget-wrapper";
import { BottomNav } from "@/components/bottom-nav";
import { areTournamentsEnabled } from "@/lib/tournaments";
import { areCampsEnabled } from "@/lib/camps";
import { GoogleAnalytics } from "@/components/google-analytics";
import { NavLoader } from "@/components/nav-loader";
import { PageViewTracker } from "@/components/page-view-tracker";
import "./globals.css";


export const metadata: Metadata = {
  // Without this Next can't absolutise relative OG/Twitter image paths, and
  // several crawlers drop a preview whose image URL isn't absolute.
  metadataBase: new URL(SITE_URL),
  title: "Momentum Arena Mathura | Cricket, Football & Pickleball Turf Booking",
  description:
    "Book premium sports courts at Momentum Arena, Mathura's best multi-sport facility. Cricket turf, football ground & pickleball courts. Open 6 AM-11 PM daily. Call +91-6396177261 for booking.",
  keywords: [
    "Momentum Arena Mathura",
    "cricket turf booking Mathura",
    "football turf Mathura",
    "pickleball court Mathura",
    "sports facility Mathura",
    "turf booking Mathura",
    "sports complex Mathura",
    "Mathura sports arena",
    "cricket ground Mathura",
    "football ground near me",
    "sports courts Vrindavan",
    "Mathura Uttar Pradesh sports",
    "book cricket turf near Mathura",
    "sports facility near Vrindavan",
    "outdoor sports Mathura",
    "tournament venue Mathura",
  ],
  authors: [{ name: "Momentum Arena" }],
  creator: "Momentum Arena",
  publisher: "Momentum Arena",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    title: "Momentum Arena | Premier Sports Facility in Mathura, UP",
    description:
      "Mathura's best sports destination with Cricket, Football & Pickleball courts. Spectator seating, cafeteria & parking. Book now!",
    url: SITE_URL,
    siteName: "Momentum Arena",
    locale: "en_IN",
    type: "website",
    images: [
      {
        url: "/og-cover.jpg",
        width: 1200,
        height: 630,
        alt: "Momentum Arena - Multi-Sport Facility in Mathura",
      },
    ],
  },
  twitter: {
    // "app" would let X render an install card, but it replaces the image
    // preview entirely — a booking link shared in a group chat is better
    // served by the photo. The al:* tags above still give app-aware
    // clients the deep link.
    card: "summary_large_image",
    title: "Momentum Arena | Sports Facility in Mathura",
    description:
      "Book Cricket, Football & Pickleball courts in Mathura. Premium facility with cafeteria & parking.",
    images: ["/og-cover.jpg"],
    creator: "@momentumarena_",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  // Safari's Smart App Banner: on iPhone this offers the installed app or
  // an App Store link at the top of the page, above anything we render.
  itunes: {
    appId: APPLE_APP_ID,
  },
  other: {
    "geo.region": "IN-UP",
    "geo.placename": "Mathura",
    "geo.position": "27.509167;77.638917",
    "ICBM": "27.509167, 77.638917",
    // Chrome on Android's equivalent hint. Not a formal standard the way
    // apple-itunes-app is, but it is what the Play "app-install" crawlers
    // and several link previewers look for.
    "google-play-app": `app-id=${ANDROID_PACKAGE}`,
    // Deep-link hints so a shared momentumarena.com link can be resolved
    // to the app by clients that understand them (Twitter/X app cards,
    // some messengers). Harmless where unsupported.
    "al:ios:app_store_id": APPLE_APP_ID,
    "al:ios:app_name": "Momentum Arena",
    "al:ios:url": "momentumarena://",
    "al:android:package": ANDROID_PACKAGE,
    "al:android:app_name": "Momentum Arena",
    "al:android:url": "momentumarena://",
    "al:web:should_fallback": "true",
  },
  verification: {
    google: '8wO7NFJxDxbxsAfrEg_n-t6J5g_eE5DHJKYSdQNGSSM',
  },
};


export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let session = null;
  try {
    session = await auth();
  } catch {
    // Auth failure should not crash the entire app
  }

  // Arc quick-actions gain the Tourneys item while the module master
  // switch is ON — same rule the app's tab bar applies.
  const tournamentsEnabled = await areTournamentsEnabled().catch(() => false);
  const campsEnabled = await areCampsEnabled().catch(() => false);

  return (
    <html lang="en" suppressHydrationWarning className={michroma.variable}>
      <head>
        <script src="https://checkout.razorpay.com/v1/checkout.js" async />
        <GoogleAnalytics />
      </head>
      <body
        className={`antialiased bg-black text-white ${michroma.className}`}
      >
        <SessionProvider session={session}>
          <NavLoader />
          <PageViewTracker />
          {children}
          <BottomNav
            tournamentsEnabled={tournamentsEnabled}
            campsEnabled={campsEnabled}
          />
          <ChatWidgetWrapper />
        </SessionProvider>
      </body>
    </html>
  );
}
