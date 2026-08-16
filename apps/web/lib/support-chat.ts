import posthog from "posthog-js";

/**
 * Open the support conversation — a PostHog Support widget when it's enabled (owner
 * flips it on in PostHog → Support → Settings; posthog-js is already loaded here), and a
 * plain mailto otherwise so the button is never dead. Use this everywhere a "contact
 * support" affordance needs to actually reach someone (e.g. the slot budget CTA).
 */
export function openSupportChat(prefill?: string): void {
  // posthog.conversations exists only when Support is enabled + the SDK build supports it.
  const conversations = (posthog as unknown as { conversations?: { show?: () => void } }).conversations;
  if (conversations?.show) {
    conversations.show();
    return;
  }
  const to = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@podbay.cloud";
  const subject = encodeURIComponent("Podbay — support");
  const body = prefill ? `&body=${encodeURIComponent(prefill)}` : "";
  window.location.href = `mailto:${to}?subject=${subject}${body}`;
}

/** Whether the in-app support chat (PostHog Support) is available right now. */
export function supportChatAvailable(): boolean {
  return Boolean((posthog as unknown as { conversations?: { show?: () => void } }).conversations?.show);
}
