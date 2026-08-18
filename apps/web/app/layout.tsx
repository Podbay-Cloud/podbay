import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ConsentBanner from "@/components/consent-banner";
import { editionOss } from "@/lib/session";
import GoogleAnalytics from "@/components/google-analytics";

// Self-hosted by next/font (no external request, no layout shift). Exposed as
// the --font-inter CSS var that --font-ui builds on (see globals.css).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://podbay.cloud"),
  // A template so every page reads "<Page> · Podbay" in the tab / app switcher; the
  // default (marketing title) stands only where a page sets none (e.g. the landing,
  // which also sets its own).
  title: {
    default: "Podbay — a persistent home for your coding agents",
    template: "%s · Podbay",
  },
  description:
    "Give Claude Code a persistent cloud workspace with your project, tools, services, and automation — available from the official Claude apps.",
  openGraph: {
    title: "Podbay — a persistent home for your coding agents",
    description:
      "A persistent cloud workspace for Claude Code, available from the official Claude apps on desktop and mobile.",
    url: "https://podbay.cloud",
    siteName: "Podbay",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b1220",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Structured data: who we are (Organization) + what we are (SoftwareApplication), for rich
  // results. Sitewide because both describe the product, not one page. Copy stays truthful.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://podbay.cloud/#org",
        name: "Podbay",
        url: "https://podbay.cloud",
        description: "Always-on cloud workspaces for coding agents.",
      },
      {
        "@type": "SoftwareApplication",
        name: "Podbay",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Web",
        url: "https://podbay.cloud",
        description:
          "Give Claude Code a persistent cloud workspace with your project, tools, services, and automation, available from the official Claude apps.",
        publisher: { "@id": "https://podbay.cloud/#org" },
      },
    ],
  };

  // A self-host (OSS) install is a private single-tenant box, not the podbay.cloud product — it must
  // not emit podbay.cloud marketing structured data, cookie consent, or analytics.
  const oss = editionOss();
  return (
    <html lang="en" className={inter.variable}>
      <body>
        {!oss && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
          />
        )}
        {children}
        {/* Cookie consent + analytics are cloud-only — a single-tenant self-host install sets no
            third-party cookies and ships no analytics, so there's nothing to consent to. */}
        {!oss && (
          <>
            <ConsentBanner />
            <GoogleAnalytics />
          </>
        )}
      </body>
    </html>
  );
}
