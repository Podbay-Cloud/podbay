ALTER TABLE "pods" ADD COLUMN "provision_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pods" ADD COLUMN "provision_lease_until" timestamp;--> statement-breakpoint
ALTER TABLE "pods" ADD COLUMN "provision_error" text;