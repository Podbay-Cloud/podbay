import "server-only";
import { createAppDb, podBaseImages, eq, and, desc, sql } from "@podbay/db";
import { getPodService } from "./pod-service";

/**
 * Pod-base image manifest (docs/plans/image-manifest + openspec image-manifest spec).
 * One row per published image so an update is legible (what each digest brings) and
 * prunable. Recording promotes: the new image becomes `current`, the prior current is
 * demoted to `superseded`. Notes are auto-derived from the git commit range by the
 * caller (which has the checkout) and passed in; this module only persists.
 */

export type ImageStatus = "current" | "superseded" | "rolled-back";

export interface ImageRow {
  digest: string;
  alias: string | null;
  env: string;
  fromSha: string | null;
  toSha: string | null;
  notes: string | null;
  summary: string | null;
  sizeBytes: number | null;
  status: ImageStatus;
  builtAt: Date | null;
  builtBy: string | null;
  recordedAt: Date;
}

export interface RecordImageInput {
  digest: string;
  alias?: string | null;
  env?: string;
  toSha?: string | null;
  notes?: string | null;
  summary?: string | null;
  sizeBytes?: number | null;
  builtBy?: string | null;
  builtAt?: Date | null;
  /** false = record as historical (superseded) WITHOUT promoting — for backfilling
   * pre-manifest images. Default true (a fresh build becomes current). */
  promote?: boolean;
}

/** All images, newest BUILD first (not record time — the backfill recorded old
 * images "now", so recordedAt would invert the order). builtAt is the real build/
 * upload time; nulls (unknown) sink, tiebroken by recordedAt. */
export async function listImages(env = "pod-base"): Promise<ImageRow[]> {
  const rows = await createAppDb()
    .select()
    .from(podBaseImages)
    .where(eq(podBaseImages.env, env))
    .orderBy(sql`${podBaseImages.builtAt} desc nulls last`, desc(podBaseImages.recordedAt));
  return rows as ImageRow[];
}

/** One image row by digest (fingerprint), or null if it was never recorded. Used
 * by the cockpit's "what does this update contain?" modal to resolve the pod's
 * current image and the update target to their manifest entries. */
export async function imageByDigest(digest: string): Promise<ImageRow | null> {
  if (!digest) return null;
  const rows = await createAppDb()
    .select()
    .from(podBaseImages)
    .where(eq(podBaseImages.digest, digest));
  return (rows[0] as ImageRow) ?? null;
}

/** The digest pods launch from, per env. */
export async function currentImage(env = "pod-base"): Promise<ImageRow | null> {
  const rows = await createAppDb()
    .select()
    .from(podBaseImages)
    .where(and(eq(podBaseImages.env, env), eq(podBaseImages.status, "current")));
  return (rows[0] as ImageRow) ?? null;
}

/**
 * Record a newly built image and PROMOTE it: it becomes `current`, and the prior
 * current image (same env) is demoted to `superseded`. Idempotent by digest (a
 * re-record updates the row). fromSha is filled from the prior current's toSha.
 */
export async function recordImage(input: RecordImageInput): Promise<ImageRow> {
  const env = input.env ?? "pod-base";
  const promote = input.promote ?? true;
  const db = createAppDb();
  const prior = await currentImage(env);
  // Promoting demotes the prior current (unless it's this same digest re-recorded).
  if (promote && prior && prior.digest !== input.digest) {
    await db
      .update(podBaseImages)
      .set({ status: "superseded" })
      .where(eq(podBaseImages.digest, prior.digest));
  }
  const row = {
    digest: input.digest,
    alias: input.alias ?? null,
    env,
    fromSha: prior?.digest === input.digest ? prior.fromSha : (prior?.toSha ?? null),
    toSha: input.toSha ?? null,
    notes: input.notes ?? null,
    summary: input.summary ?? null,
    sizeBytes: input.sizeBytes ?? null,
    status: (promote ? "current" : "superseded") as ImageStatus,
    builtAt: input.builtAt ?? null,
    builtBy: input.builtBy ?? null,
    recordedAt: new Date(),
  };
  // Explicit upsert (exists → update, else insert) — robust across drivers, no
  // ON CONFLICT clause quirks. The update never touches the PK (digest).
  const { digest, ...updatable } = row;
  const existing = await db
    .select({ digest: podBaseImages.digest })
    .from(podBaseImages)
    .where(eq(podBaseImages.digest, digest));
  if (existing.length > 0) {
    await db.update(podBaseImages).set(updatable).where(eq(podBaseImages.digest, digest));
  } else {
    await db.insert(podBaseImages).values(row);
  }
  return row as ImageRow;
}

/**
 * Prune the image STORE (box disk) beyond `keepRecent`, protecting the current
 * image and any referenced by a live pod (image-manifest spec). Manifest rows are
 * the durable history and are NOT deleted — prune frees disk, not the changelog.
 */
export async function pruneImageStore(
  keepRecent = 20,
): Promise<{ deleted: string[]; kept: string[] }> {
  const cur = await currentImage();
  return getPodService().pruneImages({
    keepRecent,
    protect: cur ? [cur.digest] : [],
  });
}

/**
 * Re-promote an already-recorded image (rollback). It becomes `current`; the
 * displaced current is marked `rolled-back` so the transition is visible.
 */
export async function promoteImage(digest: string, env = "pod-base"): Promise<void> {
  const db = createAppDb();
  const prior = await currentImage(env);
  if (prior && prior.digest !== digest) {
    await db
      .update(podBaseImages)
      .set({ status: "rolled-back" })
      .where(eq(podBaseImages.digest, prior.digest));
  }
  await db.update(podBaseImages).set({ status: "current" }).where(eq(podBaseImages.digest, digest));
}
