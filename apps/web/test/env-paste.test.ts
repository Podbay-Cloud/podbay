import { describe, it, expect } from "vitest";
import { parseEnvBlob, looksLikeEnvBlob } from "@/lib/env-paste";

describe("parseEnvBlob", () => {
  it("parses KEY=VALUE lines, skipping blanks, comments, and junk", () => {
    const text = [
      "# a comment",
      "",
      "OPENAI_API_KEY=sk-123",
      "export ADMIN_PASSWORD=hunter2",
      "not a key line",
      "lowercase=nope",
    ].join("\n");
    expect(parseEnvBlob(text)).toEqual([
      { key: "OPENAI_API_KEY", value: "sk-123" },
      { key: "ADMIN_PASSWORD", value: "hunter2" },
    ]);
  });

  it("strips surrounding quotes and unquoted inline comments", () => {
    expect(parseEnvBlob(`A="one two"`)).toEqual([{ key: "A", value: "one two" }]);
    expect(parseEnvBlob(`B='x y'`)).toEqual([{ key: "B", value: "x y" }]);
    expect(parseEnvBlob(`C=bar # trailing`)).toEqual([{ key: "C", value: "bar" }]);
    // A '#' inside quotes is NOT a comment.
    expect(parseEnvBlob(`D="a # b"`)).toEqual([{ key: "D", value: "a # b" }]);
  });

  it("keeps the last value when a key repeats", () => {
    expect(parseEnvBlob("K=1\nK=2")).toEqual([{ key: "K", value: "2" }]);
  });

  it("tolerates CRLF line endings", () => {
    expect(parseEnvBlob("A=1\r\nB=2")).toEqual([
      { key: "A", value: "1" },
      { key: "B", value: "2" },
    ]);
  });
});

describe("looksLikeEnvBlob", () => {
  it("is true for a multi-line blob with an assignment", () => {
    expect(looksLikeEnvBlob("A=1\nB=2")).toBe(true);
    expect(looksLikeEnvBlob("# note\nA=1")).toBe(true);
  });

  it("is false for a single value (no newline) — a lone secret pastes normally", () => {
    expect(looksLikeEnvBlob("plain-single-secret-value")).toBe(false);
    expect(looksLikeEnvBlob("A=1")).toBe(false); // single line, treated as a value
  });

  it("is false for multi-line text with no assignment", () => {
    expect(looksLikeEnvBlob("just some\nprose here")).toBe(false);
  });
});
