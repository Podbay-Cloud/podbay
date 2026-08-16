export const LANDING_EVENT_CHANNEL = "podbay:landing";

export type LandingEventName =
  | "landing_primary_cta"
  | "landing_example_select"
  | "landing_starter_select"
  | "landing_playbook_select";

export interface LandingEventDetail {
  name: LandingEventName;
  item: string;
}

/** Vendor-neutral browser event. Without a consumer this is intentionally a no-op. */
export function trackLandingEvent(name: LandingEventName, item: string): void {
  if (typeof window === "undefined") return;
  const detail: LandingEventDetail = { name, item };
  window.dispatchEvent(new CustomEvent<LandingEventDetail>(LANDING_EVENT_CHANNEL, { detail }));
  sendLandingExperimentEvent(name, item);
}

export function sendLandingExperimentEvent(name: string, item?: string): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const payload = JSON.stringify({
    event: name,
    item,
    referrer: document.referrer || null,
    utmSource: url.searchParams.get("utm_source"),
    utmMedium: url.searchParams.get("utm_medium"),
    utmCampaign: url.searchParams.get("utm_campaign"),
  });
  try {
    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(
        "/api/experiments/landing/events",
        new Blob([payload], { type: "application/json" }),
      );
      return;
    }
    void fetch("/api/experiments/landing/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Measurement never blocks the requested interaction.
  }
}
