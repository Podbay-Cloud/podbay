import type { PodRecord } from "@podbay/control-plane";

/**
 * One image identity, shared by the owner cockpit and the admin drill-in.
 *
 * These lived as two copies of the same logic, and drifted in exactly the way
 * duplicated predicates do: the cockpit kept the update row visible while an
 * update was in flight, the admin page did not — so mid-update the owner was told
 * "Update available" while the operator's chip said "up to date". When those two
 * people are on a call together, that is the worst possible moment to disagree.
 */

/** The digest this deployment pins, per provider. An Incus image FINGERPRINT and a
 * Fly OCI digest live in different namespaces and would never match — comparing
 * across them made every Incus pod falsely show an update. */
export function pinnedDigest(provider: string | null | undefined): string | null {
  return provider === "incus"
    ? (process.env.PODBAY_INCUS_IMAGE_DIGEST ?? null)
    : (process.env.PODBAY_BASE_IMAGE?.split("@")[1] ?? null);
}

export interface ImageState {
  pinned: string | null;
  /** The pod's image differs from the pin. */
  behind: boolean;
  /** An update is running right now. */
  updating: boolean;
  /** Show the update affordance — behind OR mid-update, so progress stays visible. */
  showUpdate: boolean;
}

export function imageState(
  pod: Pick<PodRecord, "provider" | "imageDigest" | "updatingSince">,
): ImageState {
  const pinned = pinnedDigest(pod.provider);
  const behind = Boolean(pinned && pod.imageDigest && !sameDigest(pod.imageDigest, pinned));
  const updating = Boolean(pod.updatingSince);
  return { pinned, behind, updating, showUpdate: behind || updating };
}

/**
 * Do two image digests identify the SAME image, even in different forms?
 *
 * A single incus image appears as a 12-char fingerprint prefix (the `PODBAY_INCUS_IMAGE_DIGEST`
 * pin, and some pod rows), a full 64-char fingerprint (the `pod_base_images` manifest, and other pod
 * rows), or a `sha256:`-prefixed OCI digest. Raw `===` across those forms is ALWAYS false — which is
 * the bug behind a pod showing "update available" that then says "nothing changed" (a 12-char pin
 * never equals a 64-char manifest digest, so the update-info range comes back empty). Compare the
 * canonical short form instead.
 */
export function sameDigest(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return shortDigest(a) === shortDigest(b);
}

/**
 * The same 12 characters of a digest everywhere.
 *
 * It was rendered three ways — `slice(7,19)`, `slice(0,19)`, `slice(0,24)` — so an
 * owner reading their cockpit and an operator reading admin quoted NON-OVERLAPPING
 * substrings of one digest. You cannot match those by eye, which defeats the entire
 * purpose of showing a digest.
 */
export function shortDigest(d: string | null | undefined): string {
  if (!d) return "—";
  return d.startsWith("sha256:") ? d.slice(7, 19) : d.slice(0, 12);
}
