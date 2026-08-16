CREATE TABLE "pod_secrets" (
	"pod_id" text NOT NULL,
	"key" text NOT NULL,
	"blob" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pod_secrets_pod_id_key_pk" PRIMARY KEY("pod_id","key")
);
--> statement-breakpoint
ALTER TABLE "pod_secrets" ADD CONSTRAINT "pod_secrets_pod_id_pods_id_fk" FOREIGN KEY ("pod_id") REFERENCES "public"."pods"("id") ON DELETE cascade ON UPDATE no action;