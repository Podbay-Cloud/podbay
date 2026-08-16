import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import pg from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { schema } from "./schema.js";

export * from "./schema.js"; // user, session, account, verification, schema, Schema

// Re-export drizzle's query operators from THIS package so consumers
// (control-plane, etc.) build SQL with the same drizzle-orm instance the schema
// and Database type come from. Importing them straight from "drizzle-orm" pulls a
// second, peer-hash-differentiated instance whose SQL<> type is nominally
// incompatible — the source of the control-plane tsc clash. One instance, one type.
export { and, eq, or, not, sql, inArray, desc, asc, gt, gte, lt, lte, isNull } from "drizzle-orm";

/** Unified DB type used across the app (both drivers satisfy this query surface). */
export type Database = PgliteDatabase<typeof schema>;

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle",
);

/** Construct a pglite-backed Database. `dataDir` persists it (across a process);
 * omit for an ephemeral in-memory instance. Migrations are NOT applied here. */
export function createPgliteDb(dataDir?: string): Database {
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  return drizzlePglite(client, { schema });
}

/** Apply migrations to a pglite Database (setup/tests). */
export async function migratePgliteDb(db: Database): Promise<void> {
  await migratePglite(db, { migrationsFolder });
}

/**
 * Create a pglite database at `dataDir`, migrate it, and CLOSE it — releasing
 * the dir so a separate process (the e2e web server) can open it. pglite is
 * single-writer, so migrate-then-close-then-open must not overlap.
 */
export async function migratePgliteDir(dataDir: string): Promise<void> {
  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  await client.close();
}

/**
 * In-process Postgres (pglite) with the schema applied — for tests and local dev.
 * No network, no external database.
 */
export async function createTestDb(): Promise<{ db: Database; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return { db, close: () => client.close() };
}

/** A standard Postgres (node-postgres) Database — used by e2e against a real
 * ephemeral Postgres (testcontainers), which the neon-http driver can't reach. */
export function createPgDb(connectionString = process.env.DATABASE_URL): Database {
  if (!connectionString) throw new Error("DATABASE_URL is required for the pg database");
  // Bound the pool hard: with the createAppDb() singleton this caps the app at `max`
  // connections total, and even in a degenerate case (a stray extra pool) a small cap
  // plus a short idle recycle keeps well clear of Postgres's default 100-client limit —
  // the self-host cockpit was hitting `too many clients` (53300).
  const pool = new pg.Pool({ connectionString, max: 8, idleTimeoutMillis: 10_000 });
  return drizzlePg(pool, { schema }) as unknown as Database;
}

/** Create a pg pool, migrate, and end it (e2e global setup). */
export async function migratePgUrl(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString });
  const db = drizzlePg(pool, { schema });
  await migratePg(db, { migrationsFolder });
  await pool.end();
}

/**
 * The database the running app should use, by `PODBAY_DB`:
 * - `pglite` → in-process pglite (`PODBAY_PGLITE_DIR`), for non-Next contexts.
 * - `pg` → standard Postgres at `DATABASE_URL` (e2e testcontainer).
 * - default → Neon HTTP (production).
 */
// PGlite is single-writer: a second handle on the same dir conflicts. The web app calls
// createAppDb() many times per request (pod-service, secret-vault, session), so the pglite
// instance MUST be a process singleton. A `pg.Pool` is ALSO stateful — each new Pool opens its
// own connections — so the pg path needs the same treatment: without it, every render plus the
// 4s provisioner poll spawned a fresh pool until Postgres hit `too many clients` (53300), which
// crashed the self-host cockpit (found dogfooding, 2026-08-13). Only Neon's HTTP driver is truly
// stateless (no persistent connections), so its handle is fine to recreate.
const PGLITE_APP_DB = Symbol.for("podbay.pgliteAppDb");
const PG_APP_DB = Symbol.for("podbay.pgAppDb");
type AppDbGlobal = typeof globalThis & { [PGLITE_APP_DB]?: Database; [PG_APP_DB]?: Database };
export function createAppDb(): Database {
  const g = globalThis as AppDbGlobal;
  if (process.env.PODBAY_DB === "pglite") {
    return (g[PGLITE_APP_DB] ??= createPgliteDb(process.env.PODBAY_PGLITE_DIR));
  }
  if (process.env.PODBAY_DB === "pg") return (g[PG_APP_DB] ??= createPgDb());
  return createNeonDb();
}

/**
 * Production database over Neon serverless (HTTP driver — no WebSocket needed).
 * Synchronous: the driver connects lazily on first query, so this is safe to call
 * when wiring better-auth. Migrations are applied at deploy time via drizzle-kit.
 */
export function createNeonDb(databaseUrl = process.env.DATABASE_URL): Database {
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the production database");
  return drizzleNeon(neon(databaseUrl), { schema }) as unknown as Database;
}
