# @podbay/db

Drizzle schema + a connection factory that selects the driver by environment, so database code
is testable without an external database.

- **Production**: `createNeonDb(url)` — Neon serverless over the HTTP driver (no WebSocket).
- **Tests / local**: `createTestDb()` — in-process Postgres (pglite) with migrations applied. No
  network.

```ts
import { createTestDb, createNeonDb, user, session } from "@podbay/db";

// tests
const { db, close } = await createTestDb();
await db.insert(user).values({ id, name, email });
await close();

// production
const db = createNeonDb(process.env.DATABASE_URL);
```

## Schema

The tables better-auth requires: `user`, `session`, `account`, `verification` — portable
Postgres so the same schema runs on Neon and pglite.

## Migrations

Generated with drizzle-kit into `drizzle/`:

```bash
pnpm -F @podbay/db db:generate   # after editing schema.ts — commit the SQL
```

`createTestDb()` applies them to a fresh pglite. In production, apply them at deploy time
(`drizzle-kit migrate` against `DATABASE_URL`).
