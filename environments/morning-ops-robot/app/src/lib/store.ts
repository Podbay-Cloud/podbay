import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Digest } from "./types";

// On-disk JSON store. Lives in the pod's persistent volume (cwd = ~/work), so the
// digest history survives restarts/wake. Swap for Postgres later if it outgrows this.
const FILE = path.join(process.cwd(), "data", "digests.json");

async function readAll(): Promise<Digest[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Digest[];
  } catch {
    return [];
  }
}

async function writeAll(digests: Digest[]): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(digests, null, 2));
}

const uid = () => Math.random().toString(36).slice(2, 10);
const today = () => new Date().toISOString().slice(0, 10);

function asStrings(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

export async function listDigests(): Promise<Digest[]> {
  return (await readAll()).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export async function getDigest(id: string): Promise<Digest | null> {
  return (await readAll()).find((d) => d.id === id) ?? null;
}

export async function createDigest(input: Partial<Digest>): Promise<Digest> {
  const digests = await readAll();
  const digest: Digest = {
    id: uid(),
    date: (input.date ?? "").trim() || today(),
    summary: input.summary?.trim() || "Digest",
    changed: asStrings(input.changed),
    needsAttention: asStrings(input.needsAttention),
    actions: asStrings(input.actions),
    createdAt: new Date().toISOString(),
  };
  digests.push(digest);
  await writeAll(digests);
  return digest;
}
