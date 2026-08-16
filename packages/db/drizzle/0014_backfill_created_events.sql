-- Data backfill (no schema change): seed a `created` event, at the pod's real
-- created_at, for every pod that predates the event log (docs/observability-
-- plan.md — "seed created from pods.created_at"). Without an opening event the
-- lifecycle fold can't measure the pod's first awake interval, so totals
-- under-report real life (the GTM pod showed "Awake 16m" over a 2-day-old pod).
--
-- Idempotent twice over: it only runs once (podbay_migrations tracking), and the
-- NOT EXISTS guard means re-running would still insert nothing. id is derived
-- from pod_id so a retry can't create duplicates. ownerId is denormalized onto
-- the event, matching how emit() writes it.
INSERT INTO pod_events (id, pod_id, owner_id, type, at, meta)
SELECT
  'backfill-created-' || p.id,
  p.id,
  p.owner_id,
  'created',
  p.created_at,
  '{"reason":"backfill"}'::jsonb
FROM pods p
WHERE NOT EXISTS (
  SELECT 1 FROM pod_events e WHERE e.pod_id = p.id AND e.type = 'created'
);
