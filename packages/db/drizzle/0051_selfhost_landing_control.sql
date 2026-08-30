ALTER TABLE "landing_experiment_runs" DROP CONSTRAINT IF EXISTS "landing_runs_pin_check";
--> statement-breakpoint
ALTER TABLE "landing_experiment_runs" ADD CONSTRAINT "landing_runs_pin_check" CHECK ("landing_experiment_runs"."pinned_variant" is null or "landing_experiment_runs"."pinned_variant" in ('outcomes', 'agent-computer', 'agent-home', 'selfhost'));
--> statement-breakpoint
ALTER TABLE "landing_experiment_assignments" DROP CONSTRAINT IF EXISTS "landing_assignments_variant_check";
--> statement-breakpoint
ALTER TABLE "landing_experiment_assignments" ADD CONSTRAINT "landing_assignments_variant_check" CHECK ("landing_experiment_assignments"."variant" in ('outcomes', 'agent-computer', 'agent-home', 'selfhost'));
--> statement-breakpoint
ALTER TABLE "landing_experiment_events" DROP CONSTRAINT IF EXISTS "landing_events_variant_check";
--> statement-breakpoint
ALTER TABLE "landing_experiment_events" ADD CONSTRAINT "landing_events_variant_check" CHECK ("landing_experiment_events"."variant" in ('outcomes', 'agent-computer', 'agent-home', 'selfhost'));
--> statement-breakpoint
ALTER TABLE "landing_experiment_audit" DROP CONSTRAINT IF EXISTS "landing_audit_action_check";
--> statement-breakpoint
ALTER TABLE "landing_experiment_audit" ADD CONSTRAINT "landing_audit_action_check" CHECK ("landing_experiment_audit"."action" in ('stop', 'pin', 'unpin'));
--> statement-breakpoint
ALTER TABLE "landing_experiment_audit" DROP CONSTRAINT IF EXISTS "landing_audit_pin_check";
--> statement-breakpoint
ALTER TABLE "landing_experiment_audit" ADD CONSTRAINT "landing_audit_pin_check" CHECK (("landing_experiment_audit"."previous_pinned_variant" is null or "landing_experiment_audit"."previous_pinned_variant" in ('outcomes', 'agent-computer', 'agent-home', 'selfhost')) and ("landing_experiment_audit"."next_pinned_variant" is null or "landing_experiment_audit"."next_pinned_variant" in ('outcomes', 'agent-computer', 'agent-home', 'selfhost')));
