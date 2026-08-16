-- Rename the pod status/event token `sleeping` → `suspended` (2026-08-02).
-- Both columns are free-text; this rewrites existing rows to the new canonical
-- token. Readers stay tolerant of the legacy value during rollout.
UPDATE "pods" SET "status" = 'suspended' WHERE "status" = 'sleeping';
--> statement-breakpoint
UPDATE "pod_events" SET "type" = 'suspended' WHERE "type" = 'sleeping';
