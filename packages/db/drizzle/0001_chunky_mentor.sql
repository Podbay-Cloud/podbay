CREATE TABLE "pods" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"environment_name" text NOT NULL,
	"status" text NOT NULL,
	"region" text NOT NULL,
	"keep_awake" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_active_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pods" ADD CONSTRAINT "pods_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pods_owner_id_idx" ON "pods" USING btree ("owner_id");