import type { Metadata } from "next";
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
import { GoogleAnalytics } from "@/components/google-analytics";
import { PageViewTracker } from "@/components/page-view-tracker";
import "./globals.css";


export const metadata: Metadata = {
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
    url: "https://momentumarena.com",
    siteName: "Momentum Arena",
    locale: "en_IN",
    type: "website",
    images: [
      {
        url: "/icon.png",
        width: 1200,
        height: 630,
        alt: "Momentum Arena - Multi-Sport Facility in Mathura",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Momentum Arena | Sports Facility in Mathura",
    description:
      "Book Cricket, Football & Pickleball courts in Mathura. Premium facility with cafeteria & parking. Coming Soon!",
    images: ["/icon.png"],
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
  other: {
    "geo.region": "IN-UP",
    "geo.placename": "Mathura",
    "geo.position": "27.509167;77.638917",
    "ICBM": "27.509167, 77.638917",
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
          <PageViewTracker />
          {children}
          <BottomNav />
          <ChatWidgetWrapper />
        </SessionProvider>
      </body>
    </html>
  );
}
