import { describe, it, expect } from "vitest";
import { eventSentence } from "@/lib/event-sentence";

describe("event sentences", () => {
  it("says what happened, not which keys exist", () => {
    // The old timeline printed "update_stage" beside "stage, agent" — proof that
    // data existed, not information.
    expect(eventSentence({ type: "update_stage", meta: { stage: "recreating" } })).toBe(
      "Updating: recreating",
    );
    expect(eventSentence({ type: "agent_added", meta: { agent: "codex" } })).toBe(
      "Codex added to this pod",
    );
  });

  it("names agents the way people say them", () => {
    expect(eventSentence({ type: "agent_added", meta: { agent: "claude-code" } })).toContain("Claude");
    expect(eventSentence({ type: "repair_gave_up", meta: { target: "codex" } })).toContain("Codex");
  });

  it("distinguishes a self-repair from a doctor repair", () => {
    expect(eventSentence({ type: "pod_repaired", meta: { target: "claude-code" } })).toMatch(
      /Claude was restarted automatically/,
    );
    expect(
      eventSentence({ type: "pod_repaired", meta: { by: "doctor", fixed: ["codex-runtime-missing"] } }),
    ).toMatch(/Doctor repaired codex-runtime-missing/);
    expect(eventSentence({ type: "pod_repaired", meta: { target: "session" } })).toMatch(/session/);
  });

  it("attributes Podbay's own actions in language a person would write", () => {
    expect(eventSentence({ type: "admin_action", meta: { action: "suspend" } })).toBe(
      "Podbay suspended this pod",
    );
    expect(eventSentence({ type: "admin_action", meta: { action: "change the pod's image" } })).toBe(
      "Podbay changed the pod's image",
    );
    expect(
      eventSentence({ type: "admin_action", meta: { action: "run doctor and apply safe repairs" } }),
    ).toBe("Podbay ran doctor and apply safe repairs");
  });

  it("shortens digests instead of printing 64 hex characters", () => {
    const s = eventSentence({
      type: "updated",
      meta: { from: "a".repeat(64), to: "b".repeat(64) },
    });
    expect(s).toContain("aaaaaaaaaaaa");
    expect(s).not.toContain("a".repeat(20));
  });

  it("an UNKNOWN event reads awkwardly rather than invisibly", () => {
    // A new event type must never render as a blank row — that is how a log stops
    // being trustworthy.
    expect(eventSentence({ type: "some_new_event", meta: null })).toBe("Some new event");
  });

  it("survives missing meta everywhere", () => {
    for (const type of ["created", "updated", "update_failed", "resized", "error", "admin_action"]) {
      expect(eventSentence({ type, meta: null }).length).toBeGreaterThan(0);
    }
  });
});
