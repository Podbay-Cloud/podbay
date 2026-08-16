import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Your Assistant",
  description: "A personal AI assistant, built on Podbay.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Cover the notch/home-bar; let the layout resize when the keyboard opens
  // (Chrome), which — with the visual-viewport handling in page.tsx — keeps the
  // composer above the keyboard instead of behind it.
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // suppressHydrationWarning: the mobile browser / preview proxy can add its own
  // attributes to <html> before React hydrates (a well-known false-positive) —
  // this scopes the suppression to <html>'s own attributes only.
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
