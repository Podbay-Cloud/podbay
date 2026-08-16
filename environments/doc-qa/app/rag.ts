import "server-only";
import { Pool } from "pg";
import { DEMO_DOCS } from "./demo";

// Retrieval over the user's uploaded documents, backed by the pod's baked
// Postgres (no extra service, no API key). v1 uses Postgres FULL-TEXT search
// (tsvector + GIN) — real "ask my docs" grounding with zero setup. Semantic
// retrieval (pgvector + an embedding provider) is a clean upgrade: swap `search`
// for a vector query and add an embed step in `addDocument`; the rest is unchanged.

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://dev@localhost:5432/app",
  max: 4,
});

let ready: Promise<void> | null = null;
function ensure(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS doc_chunks (
          id bigserial PRIMARY KEY,
          doc text NOT NULL,
          chunk_idx int NOT NULL,
          content text NOT NULL,
          tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
          created_at timestamptz DEFAULT now()
        )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS doc_chunks_tsv ON doc_chunks USING gin(tsv)`);
      // Every question asked of the public bot, and whether the docs could answer
      // it. The UNANSWERED ones are the owner's roadmap for what docs to add.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS questions (
          id bigserial PRIMARY KEY,
          question text NOT NULL,
          answered boolean NOT NULL,
          sources text[] NOT NULL DEFAULT '{}',
          asked_at timestamptz DEFAULT now()
        )`);
    })().catch((e) => {
      ready = null; // let a later call retry if the DB wasn't up yet
      throw e;
    });
  }
  return ready;
}

/** Split text into ~1200-char chunks on paragraph/line boundaries, with a little
 * overlap so an answer that straddles a boundary is still retrievable. */
function chunk(text: string, size = 1200, overlap = 150): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length <= size) return clean ? [clean] : [];
  const out: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + size, clean.length);
    if (end < clean.length) {
      const brk = clean.lastIndexOf("\n", end);
      if (brk > i + size / 2) end = brk; // prefer a line boundary
    }
    out.push(clean.slice(i, end).trim());
    i = end - overlap > i ? end - overlap : end;
  }
  return out.filter(Boolean);
}

/** Add (or replace) a document by name. Returns the chunk count. */
export async function addDocument(name: string, text: string): Promise<number> {
  await ensure();
  const chunks = chunk(text);
  await pool.query("DELETE FROM doc_chunks WHERE doc = $1", [name]);
  for (let i = 0; i < chunks.length; i++) {
    await pool.query("INSERT INTO doc_chunks(doc, chunk_idx, content) VALUES ($1,$2,$3)", [name, i, chunks[i]]);
  }
  return chunks.length;
}

/** Top-k chunks matching the query (full-text rank). Empty on no match / no DB. */
export async function search(query: string, k = 5): Promise<Array<{ doc: string; content: string }>> {
  await ensure();
  const { rows } = await pool.query(
    `SELECT doc, content
       FROM doc_chunks
      WHERE tsv @@ plainto_tsquery('english', $1)
      ORDER BY ts_rank(tsv, plainto_tsquery('english', $1)) DESC
      LIMIT $2`,
    [query, k],
  );
  return rows as Array<{ doc: string; content: string }>;
}

/** Uploaded documents with their chunk counts. */
export async function listDocuments(): Promise<Array<{ doc: string; chunks: number }>> {
  await ensure();
  const { rows } = await pool.query(
    "SELECT doc, count(*)::int AS chunks FROM doc_chunks GROUP BY doc ORDER BY doc",
  );
  return rows as Array<{ doc: string; chunks: number }>;
}

export async function deleteDocument(name: string): Promise<void> {
  await ensure();
  await pool.query("DELETE FROM doc_chunks WHERE doc = $1", [name]);
}

/** True if any document is indexed. */
export async function hasDocuments(): Promise<boolean> {
  await ensure();
  const { rows } = await pool.query("SELECT 1 FROM doc_chunks LIMIT 1");
  return rows.length > 0;
}

/** Seed the demo corpus on first boot so the bot answers immediately. Runs once,
 * only when NO documents exist — never overwrites the owner's real docs. */
let seeded: Promise<void> | null = null;
export function seedDemoIfEmpty(): Promise<void> {
  if (!seeded) {
    seeded = (async () => {
      if (await hasDocuments()) return;
      for (const d of DEMO_DOCS) await addDocument(d.name, d.text);
    })().catch((e) => {
      seeded = null; // retry next time if the DB wasn't ready
      throw e;
    });
  }
  return seeded;
}

/** Record a question and whether the docs could ground it (best-effort). */
export async function logQuestion(question: string, answered: boolean, sources: string[]): Promise<void> {
  try {
    await ensure();
    await pool.query("INSERT INTO questions(question, answered, sources) VALUES ($1,$2,$3)", [
      question.slice(0, 2000),
      answered,
      sources,
    ]);
  } catch {
    /* logging must never break answering */
  }
}

/** Recent questions for the owner console — newest first. */
export async function recentQuestions(
  limit = 100,
): Promise<Array<{ question: string; answered: boolean; sources: string[]; asked_at: string }>> {
  await ensure();
  const { rows } = await pool.query(
    "SELECT question, answered, sources, asked_at FROM questions ORDER BY asked_at DESC LIMIT $1",
    [limit],
  );
  return rows as Array<{ question: string; answered: boolean; sources: string[]; asked_at: string }>;
}
