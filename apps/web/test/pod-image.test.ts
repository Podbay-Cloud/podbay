import { describe, it, expect, afterEach } from "vitest";
import { imageState, shortDigest, sameDigest, imageVersionLabel } from "@/lib/pod-image";

const pod = (over: Record<string, unknown> = {}) =>
  ({ provider: "incus", imageDigest: "abc", updatingSince: null, ...over }) as never;

afterEach(() => {
  delete process.env.PODBAY_INCUS_IMAGE_DIGEST;
  delete process.env.PODBAY_BASE_IMAGE;
});

describe("image state is one predicate, not two", () => {
  it("keeps the update affordance visible mid-update", () => {
    // The cockpit and admin each computed this, and disagreed HERE: mid-update the
    // owner saw "update available" while the operator's chip said "up to date" —
    // the worst moment for the two of them to describe a pod differently.
    process.env.PODBAY_INCUS_IMAGE_DIGEST = "abc";
    const s = imageState(pod({ updatingSince: new Date().toISOString() }));
    expect(s.behind).toBe(false);
    expect(s.updating).toBe(true);
    expect(s.showUpdate).toBe(true);
  });

  it("does not compare an Incus fingerprint against a Fly digest", () => {
    // They live in different namespaces and would never match, which once made
    // every Incus pod falsely show an update.
    process.env.PODBAY_BASE_IMAGE = "registry/img@sha256:fly";
    expect(imageState(pod({ provider: "incus" })).pinned).toBeNull();
  });

  it("is up to date when the pod matches the pin", () => {
    process.env.PODBAY_INCUS_IMAGE_DIGEST = "abc";
    expect(imageState(pod()).showUpdate).toBe(false);
  });
});

describe("digests are quoted the same way everywhere", () => {
  it("shows the same 12 characters regardless of the sha256: prefix", () => {
    // Rendered three ways before — slice(7,19), slice(0,19), slice(0,24) — so an
    // owner and an operator quoted non-overlapping substrings of one digest and
    // could not match them by eye.
    expect(shortDigest("sha256:0a5baad9021a37dd")).toBe("0a5baad9021a");
    expect(shortDigest("0a5baad9021a37dd")).toBe("0a5baad9021a");
  });
  it("never renders 'undefined'", () => {
    expect(shortDigest(null)).toBe("—");
  });
});

describe("sameDigest matches across digest FORMS (the 'nothing changed' bug)", () => {
  const short = "31c374efda9a";
  const full = "31c374efda9a5fbc750f2efd0ca9b794332d56def04a991601e6e9abb9fc70e3";
  it("a 12-char pin/pod digest equals the full 64-char manifest digest of the same image", () => {
    // The exact scenario: pin/pod = 12-char, pod_base_images manifest = 64-char. Raw === was false,
    // so the update range came back empty → "nothing changed" for a real build.
    expect(sameDigest(short, full)).toBe(true);
    expect(sameDigest(full, short)).toBe(true);
  });
  it("also handles a sha256: OCI form of the same image", () => {
    expect(sameDigest(`sha256:${full}`, short)).toBe(true);
  });
  it("different images do not match", () => {
    expect(sameDigest(short, "9378fecc3f6261ace00d2c87246d8d0e3021c3172a87accef8e90cce5369879e")).toBe(false);
  });
  it("null/undefined never matches (no false 'up to date')", () => {
    expect(sameDigest(null, full)).toBe(false);
    expect(sameDigest(short, undefined)).toBe(false);
  });
  it("imageState: a full-digest pod on the current image is NOT falsely 'behind' a 12-char pin", () => {
    process.env.PODBAY_INCUS_IMAGE_DIGEST = short;
    const s = imageState({ provider: "incus", imageDigest: full, updatingSince: null });
    expect(s.behind).toBe(false); // was TRUE with raw !== → false "update available"
  });
});

describe("imageVersionLabel — version alongside the digest, never instead of it", () => {
  it("shows version WITH the short digest (a version is not unique per build)", () => {
    expect(imageVersionLabel("0.1.0", "a1b2c3d4e5f6aaaa")).toBe("v0.1.0 (a1b2c3d4e5f6)");
  });

  it("falls back to the short digest alone when there is no version — the common path today (§1.4)", () => {
    expect(imageVersionLabel(null, "a1b2c3d4e5f6aaaa")).toBe("a1b2c3d4e5f6");
    expect(imageVersionLabel(undefined, "sha256:0a5baad9021a37dd")).toBe("0a5baad9021a");
    expect(imageVersionLabel("   ", "a1b2c3d4e5f6aaaa")).toBe("a1b2c3d4e5f6");
  });

  it("normalizes a leading v so '0.1.0' and 'v0.1.0' render identically", () => {
    expect(imageVersionLabel("v0.1.0", "a1b2c3d4e5f6aaaa")).toBe("v0.1.0 (a1b2c3d4e5f6)");
  });

  it("degrades sanely when the digest is unknown", () => {
    expect(imageVersionLabel("0.1.0", null)).toBe("v0.1.0");
    expect(imageVersionLabel(null, null)).toBe("—");
  });
});
