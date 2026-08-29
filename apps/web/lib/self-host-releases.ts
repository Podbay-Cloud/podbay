import { sameDigest } from "@/lib/pod-image";

/**
 * Self-host reads what an update contains from a STATIC release manifest published to the public
 * install repo — never from podbay.cloud (release-versioning §4, decision 4). A self-host install is
 * independent of the hosted product, so the fetch targets github's raw host and any failure degrades
 * to the from→to digest line the cockpit already shows.
 *
 * The publisher is `scripts/publish-install-mirror.sh` (it writes releases.json from the cloud
 * manifest via the admin API); this is the consumer half.
 */
export const SELF_HOST_RELEASES_URL =
  "https://raw.githubusercontent.com/podbay-cloud/install/main/releases.json";

export interface SelfHostRelease {
  version: string;
  digest: string;
  summary: string | null;
  notes: string | null;
  builtAt: string | null;
}

/**
 * Parse the published releases.json into validated releases. Tolerant by construction: a malformed
 * document, a missing array, or entries without a version/digest yield an empty list rather than
 * throwing — a broken manifest must never take down the cockpit, it just falls back to digests.
 */
export function parseReleases(raw: unknown): SelfHostRelease[] {
  const arr =
    raw && typeof raw === "object" && Array.isArray((raw as { releases?: unknown }).releases)
      ? ((raw as { releases: unknown[] }).releases)
      : [];
  const out: SelfHostRelease[] = [];
  for (const r of arr) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.version !== "string" || typeof o.digest !== "string") continue;
    out.push({
      version: o.version,
      digest: o.digest,
      summary: typeof o.summary === "string" ? o.summary : null,
      notes: typeof o.notes === "string" ? o.notes : null,
      builtAt: typeof o.builtAt === "string" ? o.builtAt : null,
    });
  }
  return out;
}

/**
 * The release describing a given image digest, matched by canonical digest form (self-host pulls a
 * `latest` tag whose digest is a full fingerprint; the manifest stores full too, but normalize
 * anyway — the whole class of "12-char vs 64-char" bugs is why `sameDigest` exists). Null when no
 * published release names that digest — an unversioned build, which correctly shows digits only.
 */
export function matchRelease(
  releases: SelfHostRelease[],
  digest: string | null | undefined,
): SelfHostRelease | null {
  if (!digest) return null;
  return releases.find((r) => sameDigest(r.digest, digest)) ?? null;
}

/**
 * Fetch + match the release for `latestDigest`, NEVER throwing. Any failure (offline, air-gapped, a
 * 404, malformed JSON) returns null and the caller shows the digest line — update availability does
 * not depend on reaching this file. `fetchImpl` is injectable for tests. Deliberately short-timeout
 * so a slow/hung host never stalls a cockpit render.
 */
export async function fetchSelfHostRelease(
  latestDigest: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<SelfHostRelease | null> {
  if (!latestDigest) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetchImpl(SELF_HOST_RELEASES_URL, {
      signal: ctrl.signal,
      // The published file is static; a short cache keeps repeated cockpit renders off the network.
      cache: "no-store",
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    return matchRelease(parseReleases(await res.json()), latestDigest);
  } catch {
    return null; // offline / air-gapped / malformed — degrade to the digest line
  }
}
