import posthog from "posthog-js";
import { scrubEventProperties } from "@/lib/analytics-scrub";
import { CONSENT_COOKIE, readConsentFromDocument } from "@/lib/consent";

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

// GDPR/ePrivacy: non-essential (analytics) cookies need consent BEFORE they're set. So
// until the visitor has accepted, PostHog runs in MEMORY persistence (no cookies) and
// opted OUT of capturing. The consent banner flips both on Accept. A returning visitor who
// already accepted is read from the first-party consent cookie here, so analytics resume
// without re-prompting. The consent cookie itself is strictly necessary, so it's exempt.
const consent = readConsentFromDocument();
const granted = consent === "granted";
void CONSENT_COOKIE;

if (!token || !host) {
  if (process.env.NODE_ENV !== "production") {
    const missing = !token ? "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN" : "NEXT_PUBLIC_POSTHOG_HOST";
    console.error(
      `${missing} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missing} is configured`,
    );
  }
} else {
  posthog.init(token, {
    api_host: "/ingest",
    ui_host: "https://us.posthog.com",
    defaults: "2026-01-30",
    capture_exceptions: true,
    debug: process.env.NODE_ENV === "development",
    // No cookies + no capture until consent (banner flips these on Accept).
    persistence: granted ? "localStorage+cookie" : "memory",
    opt_out_capturing_by_default: !granted,
    /**
     * Session replay on THIS app would otherwise record the most private material
     * in the product. The pod cockpit embeds a live terminal — the owner's source
     * code and their conversation with their agent — and the launch/settings panes
     * take secret VALUES. Project-side replay settings decide whether recording
     * happens at all; what it captures when it does is decided here, so the masking
     * has to be in the code rather than in a dashboard toggle someone can flip.
     *
     * `ph-no-capture` is applied to the terminal and to secret inputs at their
     * source; `maskAllInputs` is the backstop for any input added later by someone
     * who has never read this comment.
     */
    /**
     * Last line of defence on everything outbound. `capture_exceptions` ships
     * exception messages, stack frames and the current URL; none of ours carries a
     * credential today, but that is a fact about the code right now, not a
     * guarantee — and a leak into a third-party pipeline is one nobody is watching.
     * See lib/analytics-scrub.ts.
     */
    before_send: (event) => {
      if (event?.properties) event.properties = scrubEventProperties(event.properties);
      return event;
    },
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: ".ph-no-capture, .term-wrap, [data-ph-mask]",
    },
  });
}
