import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { STATUS_LABEL } from "@/components/pod-status";

describe("pod status labels", () => {
  it("an in-flight update is its OWN state, not a decoration on Running", () => {
    // Surfaces pass "updating" INSTEAD of the raw status. Showing "RUNNING" and
    // "updating…" together made people ask which one was true (owner, 2026-07-29).
    expect(STATUS_LABEL.updating).toBe("Updating…");
    expect(STATUS_LABEL.running).toBe("Running");
    expect(STATUS_LABEL.updating).not.toBe(STATUS_LABEL.running);
  });

  it("every state a pod can show has a human label", () => {
    for (const s of ["running", "suspended", "waking", "provisioning", "destroying", "error", "gone", "updating"]) {
      expect(STATUS_LABEL[s], `no label for "${s}"`).toBeTruthy();
    }
  });

  it("renders calm sentence-case labels rather than shouting statuses", () => {
    const source = readFileSync(path.join(process.cwd(), "components/pod-status.tsx"), "utf8");
    expect(source).not.toContain("uppercase");
  });
});
