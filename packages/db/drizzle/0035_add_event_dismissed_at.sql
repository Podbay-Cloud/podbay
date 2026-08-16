-- Server-side, cross-device dismissal of a pod's incident banner (OOM etc.): mark the
-- event dismissed rather than tracking it in the browser. Nullable; null = not dismissed.
ALTER TABLE "pod_events" ADD COLUMN IF NOT EXISTS "dismissed_at" timestamp;
