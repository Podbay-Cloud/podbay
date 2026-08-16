-- Owner-scope fetch_memory (pre-Alpha security M1): a tenant pod's fetch verdict is
-- attributed to its owner, so it can only steer its own owner's fetch ladder — not the
-- whole fleet. Existing rows become the trusted global baseline (owner_id = '').
ALTER TABLE "fetch_memory" ADD COLUMN IF NOT EXISTS "owner_id" text NOT NULL DEFAULT '';
--> statement-breakpoint
-- Drop whatever primary key exists (name is drizzle-generated) and re-key on owner.
DO $$ DECLARE c text; BEGIN
  SELECT conname INTO c FROM pg_constraint WHERE conrelid = 'fetch_memory'::regclass AND contype = 'p';
  IF c IS NOT NULL THEN EXECUTE 'ALTER TABLE "fetch_memory" DROP CONSTRAINT ' || quote_ident(c); END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "fetch_memory" ADD PRIMARY KEY ("owner_id","domain","rung");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fetch_memory_owner_domain_idx" ON "fetch_memory" ("owner_id","domain");
