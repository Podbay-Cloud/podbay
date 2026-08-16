import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

/**
 * Session replay on this app would record the most private material in the product:
 * the cockpit embeds a live terminal (the owner's code and their conversation with
 * their agent) and the launch/settings panes take secret VALUES.
 *
 * Whether recording happens is a PostHog project setting someone can toggle in a
 * dashboard; what it captures when it does is decided in our code. So these assert
 * the masking exists — a source-level guard, because there is no way to unit-test a
 * third-party recorder, and the failure mode is silent and unrecoverable (the frames
 * are already uploaded).
 */
describe("analytics never records the terminal or secret values", () => {
  it("masks inputs and the terminal in session replay config", () => {
    const src = read("instrumentation-client.ts");
    expect(src).toMatch(/session_recording/);
    expect(src).toMatch(/maskAllInputs:\s*true/);
    expect(src).toMatch(/term-wrap|ph-no-capture/);
  });

  it("marks the terminal element itself, so it is masked wherever it is mounted", () => {
    expect(read("components/pod-terminal.tsx")).toContain("ph-no-capture");
  });

  it("marks secret inputs, whose eye toggle can reveal plaintext", () => {
    // Masking by input type is not enough here: the show/hide toggle turns the field
    // into a plain text input.
    expect(read("components/ui/secret-input.tsx")).toContain("ph-no-capture");
  });
});

describe("analytics cannot fail the operation it observes", () => {
  it("never awaits a flush inside a try that reports failure to the user", () => {
    // An awaited flush inside launchPod's try turned a PostHog outage into "launch
    // failed" for a pod that had been created; the waitlist route said "could not
    // save" for an email that was saved.
    for (const f of ["lib/actions.ts", "app/api/waitlist/route.ts"]) {
      expect(read(f), `${f} must not await ph.flush()`).not.toMatch(/await\s+ph\.flush\(/);
      expect(read(f)).toMatch(/void ph\.flush\(\)\.catch/);
    }
  });
});

describe("everything outbound is scrubbed, not just what we thought to check", () => {
  it("registers a before_send scrubber on the client", () => {
    // capture_exceptions is ON deliberately (it is genuinely useful), so the
    // protection has to be at the pipeline, not at each throw site.
    const src = read("instrumentation-client.ts");
    expect(src).toMatch(/before_send/);
    expect(src).toMatch(/scrubEventProperties/);
  });
});
