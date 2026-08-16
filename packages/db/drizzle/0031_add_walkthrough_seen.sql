-- Post-create "how to connect" walkthrough — shown once per pod (pod-launch-wizard,
-- 2026-08-03). Nullable timestamp; null = not yet seen, set once so it never re-runs.
ALTER TABLE "pods" ADD COLUMN IF NOT EXISTS "walkthrough_seen_at" timestamp;
