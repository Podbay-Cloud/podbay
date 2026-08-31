import { describe, expect, it } from "vitest";
import { notesToPersist, REBUILD_ONLY_NOTES_RE, mergeReRecord } from "../lib/image-manifest";

/**
 * Re-recording an image must never DOWNGRADE its changelog to "the same software, rebuilt".
 *
 * This shipped for real on 2026-08-29: `b98693f43efe` was re-recorded to attach a summary it had
 * built without, the recorder bounded the range by the image's OWN toSha (an empty range), and the
 * manifest ended up telling every owner that a build which fixed a real bug changed nothing. The
 * range derivation is fixed in record-image.sh (reuse the original fromSha); this is the guard that
 * holds even if some other caller gets the range wrong.
 */
describe("notesToPersist", () => {
  const REBUILD = "- No changes to what your pod runs — this build is the same software, rebuilt.";
  const REAL = "- fix(pod-agent): heal an orphaned RC-off marker instead of trusting it forever";

  it("keeps the real changelog when a re-record derives a rebuild-only note — the 2026-08-29 bug", () => {
    expect(notesToPersist(REBUILD, REAL)).toBe(REAL);
  });

  it("keeps the real changelog when a re-record supplies no notes at all", () => {
    expect(notesToPersist(null, REAL)).toBe(REAL);
    expect(notesToPersist(undefined, REAL)).toBe(REAL);
    expect(notesToPersist("", REAL)).toBe(REAL);
  });

  it("takes the incoming changelog when it is real — a re-record may still CORRECT the notes", () => {
    const corrected = "- fix(provider): something else entirely";
    expect(notesToPersist(corrected, REAL)).toBe(corrected);
  });

  it("records a genuine rebuild-only note on a FIRST record (no prior to protect)", () => {
    // A no-op rebuild is a real outcome the owner must be told about honestly — the guard must not
    // suppress it, only refuse to let it overwrite something richer.
    expect(notesToPersist(REBUILD, null)).toBe(REBUILD);
    expect(notesToPersist(REBUILD, undefined)).toBe(REBUILD);
  });

  it("lets a rebuild-only note replace a prior rebuild-only note", () => {
    expect(notesToPersist(REBUILD, REBUILD)).toBe(REBUILD);
  });

  it("returns null rather than undefined when there is nothing on either side", () => {
    expect(notesToPersist(null, null)).toBeNull();
    expect(notesToPersist(undefined, undefined)).toBeNull();
  });

  it("matches the marker the recorder actually writes, with or without the bullet", () => {
    // record-image.sh writes it with a leading "- "; parseNotes strips bullets before its own check.
    expect(REBUILD_ONLY_NOTES_RE.test(REBUILD)).toBe(true);
    expect(REBUILD_ONLY_NOTES_RE.test(REBUILD.replace(/^- /, ""))).toBe(true);
    expect(REBUILD_ONLY_NOTES_RE.test(REAL)).toBe(false);
  });
});

describe("mergeReRecord — a partial re-record preserves fields the caller didn't send", () => {
  const prev = {
    digest: "1ac359", alias: "pod-base-20260830-0001", env: "pod-base", fromSha: "aaa", toSha: "bbb",
    notes: "- fix: real thing", summary: "the shipped summary", version: null,
    sizeBytes: 2928227942, status: "current" as const, builtAt: new Date("2026-08-30T00:01:00Z"),
    builtBy: "velsa", recordedAt: new Date("2026-08-30T00:02:00Z"),
  };
  // what recordImage's row-builder produces for a version-only POST (everything ?? null)
  const incomingVersionOnly = {
    alias: null, toSha: null, summary: null, version: "0.1.0", sizeBytes: null,
    builtAt: null, builtBy: null, notes: null,
  };
  // The EXACT RecordImageInput the admin route builds for cut-release's `{digest, version}` POST:
  // every field the caller omits is coerced to `null` (route.ts), NOT left undefined. Tests must use
  // this shape — the earlier `{digest, version}` input (fields undefined) never exercised the bug.
  const cutReleaseInput = {
    digest: "1ac359", version: "0.1.0",
    alias: null, toSha: null, notes: null, summary: null, sizeBytes: null, builtBy: null, builtAt: null,
  };

  it("cut-release (coerced-null POST) attaches the version and PRESERVES the whole row — the wipe bug", () => {
    const m = mergeReRecord(cutReleaseInput, prev, incomingVersionOnly);
    expect(m.version).toBe("0.1.0"); // the one field cut-release actually sent
    // Everything else, coerced to null by the route, must survive rather than being wiped.
    expect(m.summary).toBe("the shipped summary");
    expect(m.sizeBytes).toBe(2928227942);
    expect(m.alias).toBe("pod-base-20260830-0001");
    expect(m.builtAt).toEqual(new Date("2026-08-30T00:01:00Z"));
    expect(m.toSha).toBe("bbb");
    expect(m.builtBy).toBe("velsa");
    expect(m.notes).toBe("- fix: real thing");
  });

  it("a REAL value the caller sends is applied; a null is treated as not-provided", () => {
    const m = mergeReRecord(
      { ...cutReleaseInput, summary: "corrected" },
      prev,
      { ...incomingVersionOnly, summary: "corrected" },
    );
    expect(m.summary).toBe("corrected"); // real string → applied
    expect(m.builtAt).toEqual(new Date("2026-08-30T00:01:00Z")); // null → preserved
  });

  it("a re-record with version=null preserves a released version", () => {
    const released = { ...prev, version: "0.2.0" };
    const m = mergeReRecord({ ...cutReleaseInput, version: null }, released, { ...incomingVersionOnly, version: null });
    expect(m.version).toBe("0.2.0");
  });
});
