#!/usr/bin/env node
// Apply the podbay schema to a Postgres DATABASE_URL (OSS Phase 0). Retries while the server is
// still starting — a fresh `docker run postgres` runs initdb + restarts, which resets early
// connections (ECONNRESET), so firing immediately fails. Waits up to ~40s for readiness.
import { migratePgUrl } from "@podbay/db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("set DATABASE_URL (e.g. postgres://postgres:podbay@127.0.0.1:5432/podbay)");
  process.exit(1);
}

const transient = (e) => {
  const s = `${e?.cause?.code ?? ""} ${e?.cause?.message ?? ""} ${e?.message ?? ""}`;
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|starting up|the database system is|Connection terminated/i.test(s);
};

for (let i = 1; i <= 40; i++) {
  try {
    await migratePgUrl(url);
    console.log("migrated pg OK");
    process.exit(0);
  } catch (e) {
    if (i < 40 && transient(e)) {
      if (i === 1 || i % 5 === 0) console.log(`waiting for postgres to be ready… (${i}s)`);
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    console.error("migrate failed:", e?.message ?? e);
    process.exit(1);
  }
}
