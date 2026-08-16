CREATE TABLE "relay_connections" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"login_domains" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relay_pairing_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"spent_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "relay_pairing_owner_idx" ON "relay_pairing_codes" USING btree ("owner_id");