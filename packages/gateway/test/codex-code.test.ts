import { describe, expect, it } from "vitest";
import { extractCodexDeviceCode } from "../src/server.js";

describe("extractCodexDeviceCode", () => {
  const block = [
    "Follow these steps to sign in with ChatGPT using device code authorization:",
    "1. Open this link in your browser and sign in to your account",
    "   https://auth.openai.com/codex/device",
    "2. Enter this one-time code (expires in 15 minutes)",
    "   R04V-W177O",
  ].join("\n");

  it("pulls the code out of a Codex device-login block", () => {
    expect(extractCodexDeviceCode(block)).toBe("R04V-W177O");
  });

  it("returns null without the codex/device marker (never a stray token)", () => {
    // A XXXX-XXXXX-looking token elsewhere must NOT be captured.
    expect(extractCodexDeviceCode("build id ABCD-12345 finished")).toBeNull();
  });

  it("returns null when the marker is present but no code yet (chunked output)", () => {
    expect(
      extractCodexDeviceCode("…https://auth.openai.com/codex/device\n2. Enter this one-time code"),
    ).toBeNull();
  });
});
