import { describe, it, expect } from "vitest";
import { formatWarnDigest } from "../src/warn-digest.js";

describe("formatWarnDigest", () => {
  it("returns null for an empty window (no empty digests)", () => {
    expect(formatWarnDigest([])).toBeNull();
  });

  it("groups by pod, counts repeats, and uses the pod name", () => {
    const out = formatWarnDigest([
      { podId: "p1", podName: "makore", title: "Memory pressure" },
      { podId: "p1", podName: "makore", title: "Memory pressure" },
      { podId: "p1", podName: "makore", title: "A child process was OOM-killed" },
      { podId: "p2", podName: null, title: "Disk running low" },
    ]);
    expect(out).toContain("4 in the last 24h across 2 pods");
    expect(out).toContain("• makore: 2× Memory pressure, A child process was OOM-killed");
    expect(out).toContain("• p2: Disk running low"); // falls back to podId when unnamed
  });

  it("singular pod wording", () => {
    const out = formatWarnDigest([{ podId: "p1", podName: "x", title: "t" }]);
    expect(out).toContain("across 1 pod\n");
    expect(out).not.toContain("1 pods");
  });

  it("honors a custom since label", () => {
    expect(formatWarnDigest([{ podId: "p", podName: "x", title: "t" }], "7d")).toContain("last 7d");
  });
});
