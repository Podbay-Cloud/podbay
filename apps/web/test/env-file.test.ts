import { describe, it, expect } from "vitest";
import { toEnvFile } from "@/lib/env-file";
import { parseEnvBlob } from "@/lib/env-paste";

describe("toEnvFile — Secrets 'Export all' → .env", () => {
  it("leaves simple values unquoted and sorts keys", () => {
    expect(toEnvFile({ B_KEY: "two", A_KEY: "one" })).toBe("A_KEY=one\nB_KEY=two\n");
  });

  it("quotes values that need it (spaces, #, =, $, quotes) and escapes inside", () => {
    expect(toEnvFile({ K: "a b" })).toBe('K="a b"\n');
    expect(toEnvFile({ K: "a#b" })).toBe('K="a#b"\n');
    expect(toEnvFile({ K: "postgres://u:p@h/db?x=1" })).toBe('K="postgres://u:p@h/db?x=1"\n');
    expect(toEnvFile({ K: 'say "hi"' })).toBe('K="say \\"hi\\""\n');
    expect(toEnvFile({ K: "a\\b" })).toBe('K="a\\\\b"\n');
    expect(toEnvFile({ K: "line1\nline2" })).toBe('K="line1\\nline2"\n');
  });

  it("quotes an empty value so the key survives the round-trip", () => {
    expect(toEnvFile({ K: "" })).toBe('K=""\n');
  });

  it("returns empty string for no secrets", () => {
    expect(toEnvFile({})).toBe("");
  });

  // The real guarantee: export from one pod → paste into another → identical values (self-host-
  // public-previews sibling ask). Every tricky value must survive the toEnvFile → parseEnvBlob trip.
  it("round-trips through parseEnvBlob (export → paste) for tricky values", () => {
    const env = {
      SIMPLE: "value",
      URL: "postgres://u:p@h:5432/db?sslmode=require",
      SPACED: "a b c",
      HASHED: "a#b",
      QUOTED: 'say "hi" now',
      BACKSLASH: "a\\b\\c",
      MULTILINE: "-----BEGIN KEY-----\nabc\n-----END KEY-----",
      DOLLAR: "$HOME/x",
    };
    const parsed = Object.fromEntries(parseEnvBlob(toEnvFile(env)).map((p) => [p.key, p.value]));
    expect(parsed).toEqual(env);
  });
});
