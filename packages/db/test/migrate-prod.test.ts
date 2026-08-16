import { describe, it, expect } from "vitest";
import {
  splitStatements,
  baselineNames,
  runMigrations,
  pendingMigrations,
  checkMigrations,
  BASELINE,
  type Migration,
  type SqlClient,
} from "../src/migrate-prod.js";

/** In-memory SqlClient recording executed statements + a podbay_migrations table. */
class FakeClient implements SqlClient {
  executed: string[] = [];
  private applied = new Set<string>();
  async query(text: string, params?: unknown[]) {
    if (text.startsWith("CREATE TABLE IF NOT EXISTS podbay_migrations")) return { rows: [] };
    if (text.startsWith("SELECT name FROM podbay_migrations"))
      return { rows: [...this.applied].map((name) => ({ name })) };
    if (text.startsWith("INSERT INTO podbay_migrations")) {
      this.applied.add(String(params?.[0]));
      return { rows: [] };
    }
    this.executed.push(text);
    return { rows: [] };
  }
}

const migrations: Migration[] = [
  { name: "0000_init", statements: ["CREATE TABLE a"] },
  { name: BASELINE, statements: ["CREATE TABLE b"] },
  { name: "0007_clear_network", statements: ["ALTER TABLE pods ADD COLUMN lifecycle"] },
  { name: "0008_future", statements: ["CREATE TABLE c1", "CREATE TABLE c2"] },
];

describe("migrate-prod", () => {
  it("splits drizzle statement breakpoints", () => {
    expect(splitStatements("A;\n--> statement-breakpoint\nB;")).toEqual(["A;", "B;"]);
    expect(splitStatements("  \n")).toEqual([]);
  });

  it("baseline covers everything through BASELINE, not after", () => {
    expect(baselineNames(migrations)).toEqual(["0000_init", BASELINE]);
  });

  it("first run: baselines through BASELINE (no exec) and applies only what's after", async () => {
    const c = new FakeClient();
    const done = await runMigrations(c, migrations);
    // 0000 and BASELINE are recorded but NEVER executed (prod already has them).
    expect(c.executed).toEqual([
      "ALTER TABLE pods ADD COLUMN lifecycle",
      "CREATE TABLE c1",
      "CREATE TABLE c2",
    ]);
    expect(done).toEqual(["0007_clear_network", "0008_future"]);
  });

  it("second run is a no-op (each migration applied exactly once)", async () => {
    const c = new FakeClient();
    await runMigrations(c, migrations);
    c.executed = [];
    const done = await runMigrations(c, migrations);
    expect(done).toEqual([]);
    expect(c.executed).toEqual([]);
  });

  // The pre-deploy guard predicate: what does prod still owe? (This is the check that would have
  // refused shipping web ahead of 0039.)
  it("pendingMigrations: fresh DB owes only post-baseline files", () => {
    expect(pendingMigrations([], migrations)).toEqual(["0007_clear_network", "0008_future"]);
  });

  it("pendingMigrations: a DB missing one file reports exactly that file", () => {
    const applied = ["0000_init", BASELINE, "0007_clear_network"];
    expect(pendingMigrations(applied, migrations)).toEqual(["0008_future"]);
  });

  it("pendingMigrations: a fully-applied DB owes nothing", () => {
    const applied = migrations.map((m) => m.name);
    expect(pendingMigrations(applied, migrations)).toEqual([]);
  });

  it("checkMigrations reads the applied set without mutating (no CREATE/INSERT)", async () => {
    const c = new FakeClient();
    await runMigrations(c, migrations); // seed the table
    c.executed = [];
    const pending = await checkMigrations(c, migrations);
    expect(pending).toEqual([]);
    expect(c.executed).toEqual([]); // read-only: no statements executed
  });
});
