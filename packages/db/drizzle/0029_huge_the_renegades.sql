CREATE TABLE "relay_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "relay_tokens_owner_idx" ON "relay_tokens" USING btree ("owner_id");