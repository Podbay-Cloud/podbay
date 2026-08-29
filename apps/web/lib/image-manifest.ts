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

/**
 * The owner-facing text a recorder writes when a build's commit range touched nothing that goes into
 * the image (`scripts/incus/record-image.sh`). It is a REAL outcome — the digest changes on every
 * build — so it says what that means for the owner rather than naming the tooling's reason.
 *
 * Exported because it is load-bearing in two places beyond the script: `parseNotes` treats it as the
 * empty case, and `recordImage` refuses to let it overwrite a real changelog (see there).
 */
export const REBUILD_ONLY_NOTES_RE = /^\s*-?\s*No changes to what your pod runs/i;

/**
 * Which changelog should survive a re-record? Returns the notes to persist.
 *
 * Recording a summary onto an already-recorded image is a NORMAL operation (it is how a build that
 * shipped without one gets fixed), and a recorder doing it derives its changelog from an EMPTY commit
 * range unless it reuses the image's original range start — which renders as "the same software,
 * rebuilt". Persisting that would make a build which changed things tell every owner it changed
 * nothing. So a rebuild-only note never displaces a real one; every other case takes the incoming
 * value, including a genuine rebuild-only note on a first record.
 *
 * Pure so the rule can be pinned by a unit test without a database — the branching is trivial, the
 * point is that it is named and covered (observed shipping falsely on 2026-08-29).
 */
export function notesToPersist(
  incoming: string | null | undefined,
  prior: string | null | undefined,
): string | null {
  const incomingIsRebuildOnly = !incoming || REBUILD_ONLY_NOTES_RE.test(incoming);
  const priorIsReal = Boolean(prior) && !REBUILD_ONLY_NOTES_RE.test(prior as string);
  if (incomingIsRebuildOnly && priorIsReal) return prior as string;
  return incoming ?? null;
}

/** Fields a re-record may touch. `recordedAt`/`status`/`env`/`fromSha` are managed by recordImage. */
type ReRecordable = Pick<
  ImageRow,
  "alias" | "toSha" | "notes" | "summary" | "version" | "sizeBytes" | "builtAt" | "builtBy"
>;

/**
 * Merge a PARTIAL re-record over the stored row. A field the caller OMITTED (undefined in `input`)
 * keeps its stored value; a field the caller SENT is applied. Without this, a version-attach that
 * POSTs only `{digest, version}` nulled the image's summary, builtAt, size and alias — observed live
 * 2026-08-30 when cutting v0.1.0 blanked its own summary. Notes additionally get the rebuild-only
 * guard (`notesToPersist`) so a wrongly-bounded changelog never downgrades a real one.
 *
 * Pure so the preservation rule is pinned by a unit test without a database — the whole class of
 * "the re-record wiped X" bugs is why this is named and covered.
 */
export function mergeReRecord(
  input: RecordImageInput,
  prev: ImageRow,
  incoming: ReRecordable,
): ReRecordable {
  const pick = <K extends keyof ReRecordable>(k: K, provided: boolean): ReRecordable[K] =>
    provided ? incoming[k] : (prev[k] as ReRecordable[K]);
  return {
    alias: pick("alias", input.alias !== undefined),
    toSha: pick("toSha", input.toSha !== undefined),
    summary: pick("summary", input.summary !== undefined),
    version: pick("version", input.version !== undefined),
    sizeBytes: pick("sizeBytes", input.sizeBytes !== undefined),
    builtAt: pick("builtAt", input.builtAt !== undefined),
    builtBy: pick("builtBy", input.builtBy !== undefined),
    notes: notesToPersist(input.notes !== undefined ? incoming.notes : prev.notes, prev.notes),
  };
}

export type ImageStatus = "current" | "superseded" | "rolled-back";

export interface ImageRow {
  digest: string;
  alias: string | null;
  env: string;
  fromSha: string | null;
  toSha: string | null;
  notes: string | null;
  summary: string | null;
  /** Optional release version label (release-versioning). Null for every pre-versioning row and any
   * build not cut as a release; the digest, not this, is identity. */
  version: string | null;
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
  version?: string | null;
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
    version: input.version ?? null,
    sizeBytes: input.sizeBytes ?? null,
    status: (promote ? "current" : "superseded") as ImageStatus,
    builtAt: input.builtAt ?? null,
    builtBy: input.builtBy ?? null,
    recordedAt: new Date(),
  };
  // Explicit upsert (exists → update, else insert) — robust across drivers, no
  // ON CONFLICT clause quirks. The update never touches the PK (digest).
  const { digest, ...updatable } = row;
  const existing = await db.select().from(podBaseImages).where(eq(podBaseImages.digest, digest));
  if (existing.length > 0) {
    const merged = mergeReRecord(input, existing[0] as ImageRow, updatable);
    Object.assign(updatable, merged);
    Object.assign(row, merged);
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
