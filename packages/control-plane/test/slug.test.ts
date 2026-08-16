import { describe, it, expect } from "vitest";
import { generateSlug, SLUG_RE } from "../src/slug.js";

describe("generateSlug", () => {
  it("matches adjective-noun-4hex", () => {
    for (let i = 0; i < 50; i++) expect(generateSlug()).toMatch(SLUG_RE);
  });

  it("is highly unique across generations", () => {
    const set = new Set(Array.from({ length: 500 }, () => generateSlug()));
    // 4 hex + word pairs → collisions in 500 should be rare/none.
    expect(set.size).toBeGreaterThan(495);
  });
});
