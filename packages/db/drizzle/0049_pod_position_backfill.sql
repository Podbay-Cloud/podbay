-- Backfill `pods.position` so the dashboard's manual order is authoritative for EVERY pod.
--
-- Before this, a pod created after the owner last dragged their dashboard had `position = NULL`,
-- which `sortForDisplay` treated as "float above the hand-placed pods, ordered by status rank then
-- recency". Two consequences the owner reported (2026-08-27): those cards sat above a manual order
-- that was supposed to be authoritative, and — because status rank was part of the comparison —
-- they physically REORDERED THEMSELVES as a pod moved Working → Waiting → Idle.
--
-- Pods are now given a concrete position at creation, so this fills in the existing NULLs. The
-- backfill preserves EXACTLY what each owner currently sees: null-position pods rank above placed
-- ones (their current behaviour), ordered among themselves by last_active_at DESC, and are assigned
-- negative positions counting down from -1. Negatives keep them above the existing 0..N-1 block
-- without renumbering any row the owner deliberately placed — so no dashboard jumps on deploy.
--
-- Idempotent and additive: only rows WHERE position IS NULL are touched; already-placed rows are
-- never rewritten. Safe under the edition-parity rule (same schema for cloud + self-host; old app
-- code reading a now-non-null position behaves identically, since it already sorted by it).
UPDATE "pods" AS p
SET "position" = v.new_position
FROM (
  SELECT
    n."id",
    -- Rank REVERSED (oldest-active first) so that negating it puts the MOST-recently-active pod at
    -- the most-negative position, i.e. the TOP of an ascending sort — matching sortForDisplay's
    -- "most-recently-active first, then id ASC" for these rows. Ranking most-recent-first here
    -- would invert the owner's current on-screen order (verified against Postgres before shipping).
    -- Offset below each owner's existing minimum rather than assuming it is 0, so the backfilled
    -- rows land above every hand-placed row whatever those positions happen to be.
    COALESCE(m.min_position, 0)
      - ROW_NUMBER() OVER (PARTITION BY n."owner_id" ORDER BY n."last_active_at" ASC, n."id" DESC)
      AS new_position
  FROM "pods" AS n
  LEFT JOIN (
    SELECT "owner_id", MIN("position") AS min_position
    FROM "pods" WHERE "position" IS NOT NULL GROUP BY "owner_id"
  ) AS m ON m."owner_id" = n."owner_id"
  WHERE n."position" IS NULL
) AS v
WHERE p."id" = v."id" AND p."position" IS NULL;
