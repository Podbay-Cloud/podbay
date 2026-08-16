CREATE TABLE "landing_experiment_assignments" (
	"experiment_id" text NOT NULL,
	"visitor_id" text NOT NULL,
	"variant" text NOT NULL,
	"eligible" boolean DEFAULT true NOT NULL,
	"user_id" text,
	"referrer" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "landing_experiment_assignments_experiment_id_visitor_id_pk" PRIMARY KEY("experiment_id","visitor_id"),
	CONSTRAINT "landing_assignments_variant_check" CHECK ("landing_experiment_assignments"."variant" in ('outcomes', 'agent-computer'))
);
--> statement-breakpoint
CREATE TABLE "landing_experiment_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"experiment_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"previous_status" text NOT NULL,
	"previous_pinned_variant" text,
	"next_status" text NOT NULL,
	"next_pinned_variant" text,
	"at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "landing_audit_action_check" CHECK ("landing_experiment_audit"."action" in ('stop', 'pin')),
	CONSTRAINT "landing_audit_status_check" CHECK ("landing_experiment_audit"."previous_status" in ('active', 'stopped') and "landing_experiment_audit"."next_status" in ('active', 'stopped')),
	CONSTRAINT "landing_audit_pin_check" CHECK (("landing_experiment_audit"."previous_pinned_variant" is null or "landing_experiment_audit"."previous_pinned_variant" in ('outcomes', 'agent-computer')) and ("landing_experiment_audit"."next_pinned_variant" is null or "landing_experiment_audit"."next_pinned_variant" in ('outcomes', 'agent-computer')))
);
--> statement-breakpoint
CREATE TABLE "landing_experiment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"experiment_id" text NOT NULL,
	"visitor_id" text NOT NULL,
	"user_id" text,
	"variant" text NOT NULL,
	"type" text NOT NULL,
	"item" text,
	"at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "landing_events_variant_check" CHECK ("landing_experiment_events"."variant" in ('outcomes', 'agent-computer')),
	CONSTRAINT "landing_events_type_check" CHECK ("landing_experiment_events"."type" in ('landing_exposure', 'landing_primary_cta', 'landing_example_select', 'landing_starter_select', 'landing_playbook_select', 'signin_completed', 'pod_created', 'agent_connected', 'first_project_opened'))
);
--> statement-breakpoint
CREATE TABLE "landing_experiment_runs" (
	"experiment_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"pinned_variant" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"stopped_at" timestamp,
	"rejected_events" integer DEFAULT 0 NOT NULL,
	"duplicate_events" integer DEFAULT 0 NOT NULL,
	"ingestion_failures" integer DEFAULT 0 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "landing_runs_status_check" CHECK ("landing_experiment_runs"."status" in ('active', 'stopped')),
	CONSTRAINT "landing_runs_pin_check" CHECK ("landing_experiment_runs"."pinned_variant" is null or "landing_experiment_runs"."pinned_variant" in ('outcomes', 'agent-computer'))
);
--> statement-breakpoint
ALTER TABLE "landing_experiment_assignments" ADD CONSTRAINT "landing_experiment_assignments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landing_experiment_audit" ADD CONSTRAINT "landing_experiment_audit_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landing_experiment_events" ADD CONSTRAINT "landing_experiment_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landing_experiment_runs" ADD CONSTRAINT "landing_experiment_runs_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "landing_assignments_user_idx" ON "landing_experiment_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "landing_assignments_variant_idx" ON "landing_experiment_assignments" USING btree ("experiment_id","variant");--> statement-breakpoint
CREATE INDEX "landing_audit_experiment_at_idx" ON "landing_experiment_audit" USING btree ("experiment_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "landing_events_funnel_once_idx" ON "landing_experiment_events" USING btree ("experiment_id","visitor_id","type");--> statement-breakpoint
CREATE INDEX "landing_events_experiment_at_idx" ON "landing_experiment_events" USING btree ("experiment_id","at");--> statement-breakpoint
CREATE INDEX "landing_events_user_idx" ON "landing_experiment_events" USING btree ("user_id");