import type { Metadata } from "next";
// Font is set via CSS (Arial, Helvetica, sans-serif)
import { SessionProvider } from "next-auth/react";
import { auth } from "@/lib/auth";
import "./globals.css";


export const metadata: Metadata = {
  title: "Momentum Arena Mathura | Cricket, Football, Pickleball & Badminton Turf Booking",
  description:
    "Book premium sports courts at Momentum Arena, Mathura's best multi-sport facility. Cricket turf, football ground, pickleball & badminton courts. Open 6 AM-11 PM daily. Call +91-6396177261 for booking.",
  keywords: [
    "Momentum Arena Mathura",
    "cricket turf booking Mathura",
    "football turf Mathura",
    "pickleball court Mathura",
    "badminton court Mathura",
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
    "indoor badminton Mathura",
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
      "Mathura's best sports destination with Cricket, Football, Pickleball & Badminton courts. Spectator seating, cafeteria & parking. Book now!",
    url: "https://momentumarena.in",
    siteName: "Momentum Arena",
    locale: "en_IN",
    type: "website",
    images: [
      {
        url: "/logo.png",
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
      "Book Cricket, Football, Pickleball & Badminton courts in Mathura. Premium facility with cafeteria & parking. Coming Soon!",
    images: ["/logo.png"],
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
    google: 'plgoY81Iqkkwh00zqWUIQWsc2T7JzsbkQT87g4BzxCc',
  },
};


export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className="antialiased"
        style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
      >
        <SessionProvider session={session}>{children}</SessionProvider>
      </body>
    </html>
  );
}
