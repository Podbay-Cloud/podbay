ALTER TABLE "pods" ADD COLUMN "updating_since" timestamp;--> statement-breakpoint
ALTER TABLE "pods" ADD COLUMN "update_stage" text;