/**
 * Deploy-time migration runner (Fly `release_command`). Applies pending
 * `drizzle/*.sql` files to the production Postgres/Neon DB at DATABASE_URL, tracked
 * in a `podbay_migrations` table so each runs exactly once. Idempotent: safe to run
 * on every deploy.
 *
 * Baselining: production was migrated by hand (direct SQL) up to BASELINE before
 * this runner existed, and those early migration files are not re-runnable
 * (CREATE TABLE without IF NOT EXISTS). So on the FIRST run (empty tracking table)
 * we RECORD everything through BASELINE as already-applied WITHOUT executing it, and
 * only execute migrations after it. From then on the tracking table is authoritative.
 *
 * Runs in the gateway image (which copies the whole workspace, so `pg` + the SQL
 * files are present). The web image is a pruned Next standalone and cannot run this.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Production already had every migration through here (applied via direct SQL). */
export const BASELINE = "0006_magenta_legion";

export interface Migration {
  name: string;
  statements: string[];
}

/** drizzle separates statements within a file with a `--> statement-breakpoint` line. */
export function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Load `NNNN_*.sql` migrations from a drizzle folder, in lexical (= apply) order. */
export function loadMigrations(dir: string): Migration[] {
  return readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort()
    .map((f) => ({
      name: f.replace(/\.sql$/, ""),
      statements: splitStatements(readFileSync(path.join(dir, f), "utf8")),
    }));
}

/** Names to record (without executing) as the one-time baseline: everything up to
 * and including BASELINE. Only used when the tracking table is empty. */
export function baselineNames(migrations: Migration[], baseline = BASELINE): string[] {
  const out: string[] = [];
  for (const m of migrations) {
    out.push(m.name);
    if (m.name === baseline) break;
  }
  return out;
}

/** Minimal query surface — satisfied by pg.Client and by test doubles. */
export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<{ rows: { name: string }[] }>;
}

/** The migrations the repo has that prod has NOT applied — i.e. what a deploy still owes the DB.
 * Pure: given the applied-name set and the full migration list, return pending names in order.
 * On a fresh DB (empty applied set) everything through BASELINE counts as already-there (it was
 * hand-applied before this runner existed), so only post-baseline files are pending. This is the
 * predicate the pre-deploy guard uses to refuse shipping web ahead of its schema. */
export function pendingMigrations(
  appliedNames: Iterable<string>,
  migrations: Migration[],
  baseline = BASELINE,
): string[] {
  const applied = new Set(appliedNames);
  if (applied.size === 0) for (const n of baselineNames(migrations, baseline)) applied.add(n);
  return migrations.filter((m) => !applied.has(m.name)).map((m) => m.name);
}

/** Read-only: connect, read podbay_migrations, and return what's still pending. Does NOT create the
 * tracking table or mutate anything — safe to run against prod from a deploy preflight. */
export async function checkMigrations(client: SqlClient, migrations: Migration[], baseline = BASELINE): Promise<string[]> {
  const rows = await client
    .query(`SELECT name FROM podbay_migrations`)
    .catch(() => ({ rows: [] as { name: string }[] })); // table absent ⇒ treat as empty (fresh DB)
  return pendingMigrations(rows.rows.map((r) => r.name), migrations, baseline);
}

/** Apply pending migrations against an already-connected client. Returns applied names. */
export async function runMigrations(
  client: SqlClient,
  migrations: Migration[],
  baseline = BASELINE,
): Promise<string[]> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS podbay_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const applied = new Set((await client.query(`SELECT name FROM podbay_migrations`)).rows.map((r) => r.name));

  if (applied.size === 0) {
    for (const name of baselineNames(migrations, baseline)) {
      await client.query(`INSERT INTO podbay_migrations(name) VALUES ($1) ON CONFLICT DO NOTHING`, [name]);
      applied.add(name);
    }
  }

  const done: string[] = [];
  for (const m of migrations) {
    if (applied.has(m.name)) continue;
    for (const stmt of m.statements) await client.query(stmt);
    await client.query(`INSERT INTO podbay_migrations(name) VALUES ($1)`, [m.name]);
    done.push(m.name);
  }
  return done;
}

/** Entry point for the release_command (apply) and the pre-deploy guard (`--check`, read-only). */
async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required to migrate");
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
  const migrations = loadMigrations(dir);

  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString: url,
    // Neon requires TLS; accept the managed cert.
    ssl: url.includes("localhost") || url.includes("sslmode=disable") ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    if (checkOnly) {
      // Read-only preflight: report what prod is missing and EXIT NONZERO if anything, so a deploy
      // wrapper can refuse. Never mutates the DB.
      const pending = await checkMigrations(client as unknown as SqlClient, migrations);
      if (pending.length) {
        console.error(`migrate: ${pending.length} PENDING migration(s): ${pending.join(", ")}`);
        process.exitCode = 2;
      } else {
        console.log("migrate: up to date");
      }
      return;
    }
    const done = await runMigrations(client as unknown as SqlClient, migrations);
    console.log(done.length ? `migrate: applied ${done.join(", ")}` : "migrate: up to date");
  } finally {
    await client.end();
  }
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error("migrate FAILED:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
