ALTER TABLE "pods" ADD COLUMN "t3_control" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pods" ADD COLUMN "t3_since" timestamp;--> statement-breakpoint
ALTER TABLE "pods" ADD COLUMN "t3_stage" text;
