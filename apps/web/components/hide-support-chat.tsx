"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

/**
 * Hide the PostHog Support (Conversations) launcher bubble while mounted — the web
 * terminal is full-bleed and the floating bubble sat on top of it. PostHog injects the
 * launcher itself, so there's no component to gate; we hide it two ways and restore on
 * unmount so it comes back everywhere else:
 *   1. the SDK's own hide, if this build exposes it (the clean path);
 *   2. a scoped <style> backstop keyed on a body class, for builds/widget versions where
 *      no hide() exists. The selector targets PostHog's injected widget containers only.
 */
const STYLE_ID = "pb-hide-support-chat";
const BODY_CLASS = "pb-hide-support-chat";

export default function HideSupportChat() {
  useEffect(() => {
    const conv = (posthog as unknown as { conversations?: { hide?: () => void; show?: () => void } })
      .conversations;
    conv?.hide?.();

    if (!document.getElementById(STYLE_ID)) {
      const el = document.createElement("style");
      el.id = STYLE_ID;
      el.textContent = `
        body.${BODY_CLASS} [class*="PostHogSurvey"],
        body.${BODY_CLASS} [class*="ph-conversations"],
        body.${BODY_CLASS} [class*="posthog-conversation"],
        body.${BODY_CLASS} [id*="ph-support"],
        body.${BODY_CLASS} iframe[title*="PostHog" i] { display: none !important; }
      `;
      document.head.appendChild(el);
    }
    document.body.classList.add(BODY_CLASS);

    return () => {
      document.body.classList.remove(BODY_CLASS);
      // The launcher only reappears once the class is gone; re-showing is PostHog's default.
    };
  }, []);

  return null;
}
