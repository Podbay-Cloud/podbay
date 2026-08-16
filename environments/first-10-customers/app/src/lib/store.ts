import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Lead } from "./types";

// On-disk JSON store. Lives in the pod's persistent volume (cwd = ~/work), so the
// pipeline survives sleep/wake. Swap for Postgres later if it ever outgrows this.
const FILE = path.join(process.cwd(), "data", "crm.json");

async function readAll(): Promise<Lead[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Lead[];
  } catch {
    return [];
  }
}

async function writeAll(leads: Lead[]): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(leads, null, 2));
}

const uid = () => Math.random().toString(36).slice(2, 10);

export async function listLeads(): Promise<Lead[]> {
  return (await readAll()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getLead(id: string): Promise<Lead | null> {
  return (await readAll()).find((l) => l.id === id) ?? null;
}

export async function createLead(input: Partial<Lead>): Promise<Lead> {
  const leads = await readAll();
  const lead: Lead = {
    id: uid(),
    name: input.name?.trim() || "Untitled",
    handle: input.handle,
    source: input.source,
    fitNotes: input.fitNotes,
    status: input.status ?? "new",
    nextAction: input.nextAction,
    nextActionDate: input.nextActionDate,
    createdAt: new Date().toISOString(),
    messages: [],
  };
  leads.push(lead);
  await writeAll(leads);
  return lead;
}

export async function updateLead(id: string, patch: Partial<Lead>): Promise<Lead | null> {
  const leads = await readAll();
  const i = leads.findIndex((l) => l.id === id);
  if (i === -1) return null;
  leads[i] = { ...leads[i], ...patch, id, messages: leads[i].messages };
  await writeAll(leads);
  return leads[i];
}

export async function deleteLead(id: string): Promise<void> {
  await writeAll((await readAll()).filter((l) => l.id !== id));
}

export async function addMessage(id: string, channel: string, body: string): Promise<Lead | null> {
  const leads = await readAll();
  const lead = leads.find((l) => l.id === id);
  if (!lead) return null;
  lead.messages.push({ id: uid(), at: new Date().toISOString(), channel, body });
  await writeAll(leads);
  return lead;
}
