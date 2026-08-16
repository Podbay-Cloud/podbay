-- The connect walkthrough should only greet NEWLY created pods, not pods that already
-- existed when the feature shipped. Backfill every current pod as "seen" so only pods
-- created after this migration (which start with a null flag) run the tour once.
UPDATE "pods" SET "walkthrough_seen_at" = now() WHERE "walkthrough_seen_at" IS NULL;
