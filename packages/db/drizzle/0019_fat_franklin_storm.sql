CREATE TABLE "pod_base_images" (
	"digest" text PRIMARY KEY NOT NULL,
	"alias" text,
	"env" text DEFAULT 'pod-base' NOT NULL,
	"from_sha" text,
	"to_sha" text,
	"notes" text,
	"summary" text,
	"size_bytes" integer,
	"status" text DEFAULT 'superseded' NOT NULL,
	"built_at" timestamp,
	"built_by" text,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
