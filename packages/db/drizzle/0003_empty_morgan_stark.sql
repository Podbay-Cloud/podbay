CREATE TABLE "user_agent_credentials" (
	"user_id" text NOT NULL,
	"agent" text NOT NULL,
	"blob" text NOT NULL,
	"hash" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_agent_credentials_user_id_agent_pk" PRIMARY KEY("user_id","agent")
);
--> statement-breakpoint
ALTER TABLE "user_agent_credentials" ADD CONSTRAINT "user_agent_credentials_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;