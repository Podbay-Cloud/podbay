import { describe, it, expect, afterEach } from "vitest";
import { imageState, shortDigest } from "@/lib/pod-image";

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
