CREATE TABLE "pod_events" (
	"id" text PRIMARY KEY NOT NULL,
	"pod_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"type" text NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL,
	"meta" jsonb
);
--> statement-breakpoint
CREATE INDEX "pod_events_pod_at_idx" ON "pod_events" USING btree ("pod_id","at");