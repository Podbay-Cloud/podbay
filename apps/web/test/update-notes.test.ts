import { describe, it, expect } from "vitest";
import { parseNotes, updateSummaryLine, updateHeadline } from "@/components/update-info-dialog";

describe("update notes", () => {
  it("groups by what the change MEANS to an owner and drops internal churn", () => {
    const notes = [
      "- fix(pod-agent): added agents get the REAL login flow, not a thinner copy",
      "- feat(cockpit): agent cards",
      "- build(incus): disk preflight",
    ].join("\n");
    const { entries } = parseNotes(notes);
    // build: is internal churn — real work, but nothing an owner can observe. It is DROPPED.
    expect(entries).toHaveLength(2);
    expect(entries.some((e) => /disk preflight/i.test(e.text))).toBe(false);
    // developer prefix stripped, sentence capitalised, area labelled, kind classified
    expect(entries[0]).toEqual({
      area: "agent runtime",
      kind: "fixed",
      text: "Added agents get the REAL login flow, not a thinner copy",
    });
    expect(entries[1].kind).toBe("new");
    const line = updateSummaryLine(notes)!;
    // Leads with the KIND of change, not a bare count: "1 fix, 1 new" beats "3 changes".
    expect(line).toContain("1 fix");
    expect(line).toContain("1 new");
    expect(line).toContain("agent runtime");
  });

  it("drops issue/PR refs, which point at a PRIVATE repo an owner cannot open", () => {
    const { entries } = parseNotes("- fix(pod-agent): name the RC session on a cold restart (#49)");
    expect(entries[0].text).toBe("Name the RC session on a cold restart");
    expect(entries[0].text).not.toContain("#49");
  });

  it("reports an internal-only build honestly, without calling it a rebuild", () => {
    // Every line was churn, so there is nothing to TELL the owner — but the build IS different,
    // so it must not claim "same software, rebuilt".
    const churn = ["- chore(deps): bump x", "- test(web): add a case"].join("\n");
    const p = parseNotes(churn);
    expect(p.entries).toHaveLength(0);
    expect(p.empty).toBe(false);
    expect(p.internalOnly).toBe(true);
    expect(updateSummaryLine(churn)).toMatch(/internal/i);
    expect(updateSummaryLine(churn)).not.toMatch(/rebuilt/i);
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
