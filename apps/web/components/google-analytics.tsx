import Script from "next/script";
import { CONSENT_COOKIE } from "@/lib/consent";

// GA4 measurement ID is PUBLIC by design (it ships in the client HTML on every page),
// so it's safe to keep here; override with NEXT_PUBLIC_GA_MEASUREMENT_ID if it changes.
const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || "G-5044P4GF1X";

/**
 * Google Analytics 4, wired through the SAME cookie-consent gate as PostHog
 * (see instrumentation-client.ts + consent-banner.tsx) so the two can never disagree.
 *
 * We use GA **Consent Mode v2**: every storage type defaults to `denied`, so gtag sets
 * NO analytics/ad cookies and sends only cookieless signals until the visitor accepts.
 * The inline script reads the first-party consent cookie AT RUNTIME (not at SSR, which
 * can't see it) and flips `analytics_storage` to granted for a returning visitor who
 * already accepted; the consent banner flips it live on Accept/Decline via `window.gtag`.
 *
 * Loaded only in production, so dev/preview traffic never pollutes the GA property.
 */
export default function GoogleAnalytics() {
  if (process.env.NODE_ENV !== "production" || !GA_ID) return null;

  return (
    <>
      <Script id="ga-consent-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('consent', 'default', {
            ad_storage: 'denied',
            ad_user_data: 'denied',
            ad_personalization: 'denied',
            analytics_storage: 'denied',
          });
          try {
            var m = document.cookie.match(/(?:^|; )${CONSENT_COOKIE}=([^;]+)/);
            if (m && decodeURIComponent(m[1]) === 'granted') {
              gtag('consent', 'update', { analytics_storage: 'granted' });
            }
          } catch (e) {}
          gtag('js', new Date());
          gtag('config', '${GA_ID}');
        `}
      </Script>
      <Script
        id="ga-gtag-src"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
      />
    </>
  );
}
