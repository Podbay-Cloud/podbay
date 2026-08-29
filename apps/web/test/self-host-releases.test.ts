import { describe, it, expect } from "vitest";
import {
  SELF_HOST_RELEASES_URL,
  parseReleases,
  matchRelease,
  fetchSelfHostRelease,
} from "@/lib/self-host-releases";

const REL = {
  releases: [
    { version: "0.2.0", digest: "bbbb2222cccc3333", summary: "newer", notes: "- feat: x", builtAt: "2026-09-01T00:00:00.000Z" },
    { version: "0.1.0", digest: "1ac359abcaa7f937", summary: "first", notes: "- fix: y", builtAt: "2026-08-30T00:00:00.000Z" },
  ],
};

describe("self-host release manifest — consumer half (§4)", () => {
  it("targets the public install repo, NOT podbay.cloud (decision 4.4)", () => {
    expect(SELF_HOST_RELEASES_URL).toContain("raw.githubusercontent.com/podbay-cloud/install");
    expect(SELF_HOST_RELEASES_URL).not.toContain("podbay.cloud");
  });

  describe("parseReleases is tolerant — a broken manifest never crashes the cockpit", () => {
    it("parses well-formed releases", () => {
      const r = parseReleases(REL);
      expect(r).toHaveLength(2);
      expect(r[0]).toMatchObject({ version: "0.2.0", digest: "bbbb2222cccc3333" });
    });
    it("returns [] for garbage instead of throwing", () => {
      expect(parseReleases(null)).toEqual([]);
      expect(parseReleases({})).toEqual([]);
      expect(parseReleases({ releases: "nope" })).toEqual([]);
      expect(parseReleases("<html>404</html>")).toEqual([]);
    });
    it("drops entries missing a version or digest", () => {
      const r = parseReleases({ releases: [{ version: "0.1.0" }, { digest: "abc" }, {}] });
      expect(r).toEqual([]);
    });
  });

  describe("matchRelease", () => {
    it("finds the release for a digest, normalizing short vs full forms", () => {
      const r = parseReleases(REL);
      // a 12-char pulled digest still matches the full stored one (the sameDigest class of bug)
      expect(matchRelease(r, "1ac359abcaa7")?.version).toBe("0.1.0");
      expect(matchRelease(r, "1ac359abcaa7f937c0b6")?.version).toBe("0.1.0");
    });
    it("returns null for an unversioned/unknown digest — shows digits only", () => {
      expect(matchRelease(parseReleases(REL), "deadbeef0000")).toBeNull();
      expect(matchRelease(parseReleases(REL), null)).toBeNull();
    });
  });

  describe("fetchSelfHostRelease never throws — degrades to the digest line", () => {
    it("returns the matched release on a good fetch", async () => {
      const fake = (async () => ({ ok: true, json: async () => REL })) as unknown as typeof fetch;
      expect((await fetchSelfHostRelease("1ac359abcaa7", fake))?.version).toBe("0.1.0");
    });
    it("returns null on a non-ok response (e.g. 404, air-gapped)", async () => {
      const fake = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
      expect(await fetchSelfHostRelease("1ac359abcaa7", fake)).toBeNull();
    });
    it("returns null when the fetch throws (offline)", async () => {
      const fake = (async () => {
        throw new Error("ENOTFOUND");
      }) as unknown as typeof fetch;
      expect(await fetchSelfHostRelease("1ac359abcaa7", fake)).toBeNull();
    });
    it("returns null when there is no digest to match", async () => {
      let called = false;
      const fake = (async () => {
        called = true;
        return { ok: true, json: async () => REL };
      }) as unknown as typeof fetch;
      expect(await fetchSelfHostRelease(null, fake)).toBeNull();
      expect(called).toBe(false); // no digest ⇒ no network at all
    });
  });
});
