CREATE TABLE "fetch_memory" (
	"domain" text NOT NULL,
	"rung" text NOT NULL,
	"ok_count" integer DEFAULT 0 NOT NULL,
	"fail_count" integer DEFAULT 0 NOT NULL,
	"last_outcome" text NOT NULL,
	"last_verified" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fetch_memory_domain_rung_pk" PRIMARY KEY("domain","rung")
);
--> statement-breakpoint
CREATE INDEX "fetch_memory_domain_idx" ON "fetch_memory" USING btree ("domain");