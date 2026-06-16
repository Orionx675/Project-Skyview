// =============================================================================
// app/layout.tsx — root layout: fonts, metadata, global chrome
// =============================================================================
// Fonts are loaded through next/font so they're self-hosted, zero-CLS and
// exposed as CSS variables that the Tailwind theme (globals.css) consumes:
//   Space Grotesk — display face: geometric, slightly technical, very "space"
//   IBM Plex Mono — telemetry face: tabular digits for live readouts
// =============================================================================

import type { Metadata, Viewport } from "next";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

const SITE_URL = "https://project-skyview.vercel.app/";
const SITE_DESCRIPTION =
  "A real-time cosmic radar: track the ISS, satellites and celestial bodies passing through your zenith.";

export const metadata: Metadata = {
  // Anchors every relative metadata URL (Open Graph / Twitter images, canonical
  // links) to the live production origin, so social shares — e.g. the "Look Up"
  // alert on WhatsApp — resolve to absolute URLs and preview correctly.
  metadataBase: new URL(SITE_URL),
  title: "Project Skyview — The Celestial Eye",
  description: SITE_DESCRIPTION,
  applicationName: "Project Skyview",
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Project Skyview",
    title: "Project Skyview — The Celestial Eye",
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Project Skyview — The Celestial Eye",
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#04060f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${plexMono.variable}`}>
      {/* antialiased + overflow-hidden: the dashboard is a fixed full-viewport
          instrument panel, not a scrolling document.
          suppressHydrationWarning: browser extensions (Grammarly, etc.) inject
          attributes like data-gr-ext-installed onto <body> before React
          hydrates, causing a spurious mismatch. This suppresses warnings for
          THIS element's attributes only — real mismatches elsewhere still
          surface. */}
      <body className="antialiased overflow-hidden" suppressHydrationWarning>{children}</body>
    </html>
  );
}
