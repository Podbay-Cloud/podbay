import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LANDING_EVENT_CHANNEL,
  sendLandingExperimentEvent,
  trackLandingEvent,
  type LandingEventName,
} from "../lib/landing-analytics";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("landing analytics contract", () => {
  it("uses a stable vendor-neutral event channel", () => {
    expect(LANDING_EVENT_CHANNEL).toBe("podbay:landing");
  });

  it("is a safe no-op without a browser analytics consumer", () => {
    const events: LandingEventName[] = [
      "landing_primary_cta",
      "landing_example_select",
      "landing_starter_select",
    ];
    expect(() => events.forEach((event) => trackLandingEvent(event, "test-item"))).not.toThrow();
  });

  it("uses non-blocking beacon delivery and preserves the current location", () => {
    const sendBeacon = vi.fn(() => true);
    const location = { href: "https://podbay.cloud/?utm_source=launch" };
    vi.stubGlobal("window", {
      location,
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal("document", { referrer: "https://example.com/post" });
    vi.stubGlobal("navigator", { sendBeacon });

    sendLandingExperimentEvent("landing_primary_cta", "hero");

    expect(sendBeacon).toHaveBeenCalledOnce();
    expect(sendBeacon).toHaveBeenCalledWith(
      "/api/experiments/landing/events",
      expect.any(Blob),
    );
    expect(location.href).toBe("https://podbay.cloud/?utm_source=launch");
  });
});
