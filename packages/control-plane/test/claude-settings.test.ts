import { describe, expect, it } from "vitest";
import { ControlError } from "../src/types.js";
import {
  pickClaudeSettings,
  validateClaudeSettings,
} from "../src/claude-settings.js";

describe("pickClaudeSettings (read side)", () => {
  it("extracts only the exposed keys, dropping podbay-managed + unknown ones", () => {
    const got = pickClaudeSettings({
      permissions: { allow: ["Bash(*)"] }, // podbay-managed — must not leak through
      hooks: { Stop: [] },
      model: "opus", // not exposed
      autoCompactEnabled: false,
      askUserQuestionTimeout: "30m",
      dialogExpiry: "10m",
      agentPushNotifEnabled: true,
      awaySummaryEnabled: true,
      attribution: { commit: "", pr: "x", sessionUrl: false, junk: 1 },
    });
    expect(got).toEqual({
      autoCompactEnabled: false,
      askUserQuestionTimeout: "30m",
      dialogExpiry: "10m",
      agentPushNotifEnabled: true,
      awaySummaryEnabled: true,
      attribution: { commit: "", pr: "x", sessionUrl: false },
    });
  });

  it("returns {} for garbage / wrong types", () => {
    expect(pickClaudeSettings(null)).toEqual({});
    expect(pickClaudeSettings("nope")).toEqual({});
    expect(pickClaudeSettings({ autoCompactEnabled: "yes" })).toEqual({});
  });
});

describe("validateClaudeSettings (write side — the trust boundary)", () => {
  it("passes a well-formed patch through", () => {
    const patch = {
      autoCompactEnabled: true,
      askUserQuestionTimeout: "30m",
      dialogExpiry: "5m",
      agentPushNotifEnabled: false,
      awaySummaryEnabled: true,
      attribution: { commit: "", pr: "", sessionUrl: false },
    };
    expect(validateClaudeSettings(patch)).toEqual(patch);
  });

  it("keeps null (reset-to-default) for a key", () => {
    expect(validateClaudeSettings({ autoCompactEnabled: null })).toEqual({
      autoCompactEnabled: null,
    });
  });

  it("rejects unknown top-level keys (e.g. model, permissions, __proto__)", () => {
    for (const key of ["model", "permissions", "env", "hooks", "__proto__"]) {
      expect(() => validateClaudeSettings({ [key]: "x" })).toThrow(ControlError);
    }
  });

  it("rejects unknown attribution sub-fields", () => {
    expect(() =>
      validateClaudeSettings({ attribution: { evil: "x" } }),
    ).toThrow(ControlError);
  });

  it("type-checks booleans and durations", () => {
    expect(() => validateClaudeSettings({ autoCompactEnabled: "true" })).toThrow(ControlError);
    expect(() => validateClaudeSettings({ dialogExpiry: "soon" })).toThrow(ControlError);
    expect(() => validateClaudeSettings({ dialogExpiry: "never" })).toThrow(ControlError); // expiry has no "never"
    expect(validateClaudeSettings({ askUserQuestionTimeout: "never" })).toEqual({
      askUserQuestionTimeout: "never",
    });
    expect(() => validateClaudeSettings({ askUserQuestionTimeout: "5x" })).toThrow(ControlError);
  });

  it("caps oversized attribution text", () => {
    expect(() =>
      validateClaudeSettings({ attribution: { commit: "z".repeat(5000) } }),
    ).toThrow(ControlError);
  });

  it("rejects an empty patch", () => {
    expect(() => validateClaudeSettings({})).toThrow(ControlError);
  });
});
