ALTER TABLE "relay_connections" ADD COLUMN "disconnected_at" timestamp;--> statement-breakpoint
ALTER TABLE "relay_connections" ADD COLUMN "drop_count" integer DEFAULT 0 NOT NULL;
