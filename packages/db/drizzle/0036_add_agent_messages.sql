-- Durable, owner-scoped messages between a user's own pods (agent-messaging).
-- Routing/delivery ride the reconcile poll + tmux injection; see @podbay/control-plane
-- agent-messages.ts / agent-messaging.ts. `id` is a client nonce (PK) so a re-drained
-- outbox inserts each message once.
CREATE TABLE "agent_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"from_pod" text NOT NULL,
	"to_pod" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_messages_recipient_idx" ON "agent_messages" USING btree ("owner_id","to_pod","status");--> statement-breakpoint
CREATE INDEX "agent_messages_pair_idx" ON "agent_messages" USING btree ("owner_id","from_pod","to_pod","created_at");
