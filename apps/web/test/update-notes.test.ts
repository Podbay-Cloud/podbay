import { describe, it, expect } from "vitest";
import { parseNotes, updateSummaryLine, updateHeadline } from "@/components/update-info-dialog";

describe("update notes", () => {
  it("summarises real notes by count and affected area", () => {
    const notes = [
      "- fix(pod-agent): added agents get the REAL login flow, not a thinner copy",
      "- feat(cockpit): agent cards",
      "- build(incus): disk preflight",
    ].join("\n");
    const { entries } = parseNotes(notes);
    expect(entries).toHaveLength(3);
    // developer prefix stripped, sentence capitalised, area labelled separately
    expect(entries[0]).toEqual({
      area: "agent runtime",
      text: "Added agents get the REAL login flow, not a thinner copy",
    });
    const line = updateSummaryLine(notes)!;
    expect(line).toContain("3 changes");
    expect(line).toContain("agent runtime");
    expect(line).toContain("dashboard");
  });

  it("treats a rebuild with nothing new as empty, and says so plainly", () => {
    // The recorder writes this when no image-affecting commit is in range — a real
    // outcome (every build mints a new digest), not an error.
    const rebuilt = "- No changes to what your pod runs — this build is the same software, rebuilt.";
    expect(parseNotes(rebuilt).empty).toBe(true);
    expect(updateSummaryLine(rebuilt)).toMatch(/nothing new/i);
    expect(parseNotes(null).empty).toBe(true);
    expect(parseNotes("").empty).toBe(true);
  });

  it("still counts changes when no area can be derived", () => {
    expect(updateSummaryLine("- something happened")).toBe("1 change");
  });

  it("strips internal markers that should never reach an owner", () => {
    const { entries } = parseNotes("- feat(first-10): harvest contacts into the template [no-spec]");
    expect(entries[0].text).toBe("Harvest contacts into the template");
    expect(entries[0].area).toBe("playbook apps");
  });
});

describe("updateHeadline (summary-first)", () => {
  const notes = "- feat(cockpit): agent cards\n- fix(pod-agent): login flow";

  it("prefers the hand-written user-facing summary over the commit changelog", () => {
    expect(updateHeadline("Your terminal is faster and reconnects after a restart.", notes)).toBe(
      "Your terminal is faster and reconnects after a restart.",
    );
  });

  it("uses only the first line of a multi-line summary (fits one row)", () => {
    expect(updateHeadline("Clearer activity stats.\nAnd more.", notes)).toBe("Clearer activity stats.");
  });

  it("falls back to the parsed commit summary when no summary was recorded", () => {
    // Older images predate required summaries — don't leave the row blank.
    expect(updateHeadline(null, notes)).toBe(updateSummaryLine(notes));
    expect(updateHeadline("   ", notes)).toBe(updateSummaryLine(notes));
  });

  it("falls back to the honest rebuild line when there's neither summary nor notes", () => {
    // A no-summary/no-notes image is a pure rebuild — say that, don't pretend there's news.
    expect(updateHeadline(null, null)).toBe("Same software, rebuilt — nothing new for your pod");
  });
});
