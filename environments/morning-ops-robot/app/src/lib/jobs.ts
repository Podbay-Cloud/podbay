import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Job } from "./types";

// The jobs config the pod-agent scheduler reads/writes — shared source of truth.
const DIR = path.join(process.cwd(), ".podbay");
const FILE = path.join(DIR, "ops-jobs.json");

export async function listJobs(): Promise<Job[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, "utf8")) as { jobs?: Job[] };
    return Array.isArray(parsed.jobs) ? parsed.jobs : [];
  } catch {
    return [];
  }
}

export async function writeJobs(jobs: Job[]): Promise<Job[]> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify({ jobs }, null, 2));
  return jobs;
}

/** Toggle one job's `enabled` (the dashboard's job switch). */
export async function setJobEnabled(id: string, enabled: boolean): Promise<Job[]> {
  const jobs = await listJobs();
  const next = jobs.map((j) => (j.id === id ? { ...j, enabled } : j));
  return writeJobs(next);
}
