import "server-only";
import { NextResponse } from "next/server";
import { recordImage, currentImage, pruneImageStore, listImages } from "@/lib/image-manifest";
import { createLogger } from "@podbay/shared/log";

/** How many published images the incus store keeps (newest N), on top of the
 * always-protected `current` and any image a live pod still references. Sized to
 * the build box, not to taste: ~2.6GB per image on a 79GB disk shared with the
 * docker build cache and pod volumes. Manifest rows are NOT affected. */
const IMAGE_STORE_RETENTION = 5;

const log = createLogger("api-admin-images");

function authed(req: Request): boolean | null {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) return null; // not configured
  return (req.headers.get("authorization") ?? "") === `Bearer ${expected}`;
}

/** The current image's toSha, so the helper can compute the `since..HEAD` range. */
export async function GET(req: Request): Promise<Response> {
  const ok = authed(req);
  if (ok === null) return NextResponse.json({ error: "ADMIN_API_TOKEN not configured" }, { status: 503 });
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const env = url.searchParams.get("env") ?? "pod-base";
  // `?releases=1`: the source for the static releases.json that self-host reads (release-versioning
  // §4). Only rows that carry a version — a released image describes itself; a plain build does not.
  // Newest first. This is the shape published to the public install repo, so it is deliberately just
  // the owner-facing fields, no internal shas.
  if (url.searchParams.get("releases")) {
    const rows = await listImages(env);
    return NextResponse.json({
      releases: rows
        .filter((r) => r.version)
        .map((r) => ({
          version: r.version,
          digest: r.digest,
          summary: r.summary,
          notes: r.notes,
          builtAt: r.builtAt ? r.builtAt.toISOString() : null,
        })),
    });
  }
  const cur = await currentImage(env);
  return NextResponse.json({
    currentDigest: cur?.digest ?? null,
    currentToSha: cur?.toSha ?? null,
    // The current image's OWN range start. A recorder re-recording that same digest (e.g. to attach
    // a summary it shipped without) must bound its changelog by this, not by `currentToSha` — which
    // for a re-record is the image's own end sha, giving an EMPTY range and the false "same software,
    // rebuilt" note. Mirrors recordImage's fromSha rule so notes and row agree. (Hit live 2026-08-29.)
    currentFromSha: cur?.fromSha ?? null,
  });
}

/**
 * Record a newly published pod-base image (image-manifest spec). Called by the
 * record-image helper, which runs where the git checkout lives (dev pod / build
 * host) so it can derive release notes from the commit range — the browser can't,
 * and the DB write must happen server-side (docs/plans/image-manifest, decision c).
 *
 * Auth: a bearer ADMIN_API_TOKEN (Fly secret) — a machine caller, not a session.
 */
export async function POST(req: Request): Promise<Response> {
  const ok = authed(req);
  if (ok === null) return NextResponse.json({ error: "ADMIN_API_TOKEN not configured" }, { status: 503 });
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const digest = typeof body.digest === "string" ? body.digest.trim() : "";
  if (!digest) return NextResponse.json({ error: "digest is required" }, { status: 400 });
  const promote = body.promote !== false; // default true; false = historical backfill
  try {
    const row = await recordImage({
      digest,
      alias: typeof body.alias === "string" ? body.alias : null,
      env: typeof body.env === "string" ? body.env : "pod-base",
      toSha: typeof body.toSha === "string" ? body.toSha : null,
      notes: typeof body.notes === "string" ? body.notes : null,
      summary: typeof body.summary === "string" ? body.summary : null,
      // A release version label (release-versioning). Optional — a plain build records no version and
      // the row stays digest-identified; the release-cutting flow is what supplies one.
      version: typeof body.version === "string" && body.version.trim() ? body.version.trim() : null,
      sizeBytes: typeof body.sizeBytes === "number" ? body.sizeBytes : null,
      builtBy: typeof body.builtBy === "string" ? body.builtBy : null,
      builtAt: typeof body.builtAt === "string" ? new Date(body.builtAt) : null,
      promote,
    });
    log.info("image_recorded", { digest, env: row.env, toSha: row.toSha, promote });
    // Auto-prune only on a real (promoting) record — never during a backfill.
    let pruned = 0;
    if (promote) {
      try {
        // Retention was 20, which the box cannot afford: a pod-base image is
        // ~2.6GB, so 20 of them is ~52GB on a 79GB disk that ALSO holds the
        // docker build cache and every live pod's volume. The store therefore
        // grew unbounded in practice (we hit 88% and a build died with a
        // confusing tar write error). 5 keeps four rollback targets behind
        // current for ~13GB. Manifest ROWS are unaffected — the admin history
        // and changelogs outlive the bytes (see the image-manifest spec).
        pruned = (await pruneImageStore(IMAGE_STORE_RETENTION)).deleted.length;
      } catch (e) {
        log.warn("image_autoprune_failed", { digest, err: e });
      }
    }
    return NextResponse.json({ ok: true, digest: row.digest, status: row.status, pruned });
  } catch (e) {
    const err = e as Error & { cause?: unknown };
    log.error("image_record_failed", {
      digest,
      message: err.message,
      cause: err.cause ? String(err.cause) : undefined,
    });
    return NextResponse.json({ error: "record failed" }, { status: 500 });
  }
}
