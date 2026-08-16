ALTER TABLE "pods" ADD COLUMN "size" text DEFAULT 's' NOT NULL;--> statement-breakpoint
ALTER TABLE "pods" ADD COLUMN "disk_gb" integer DEFAULT 10 NOT NULL;