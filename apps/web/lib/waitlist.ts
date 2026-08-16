import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.WAITLIST_DIR || "/data";
const FILE = path.join(DATA_DIR, "waitlist.jsonl");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return typeof email === "string" && email.length <= 254 && EMAIL_RE.test(email);
}

async function readEmails(): Promise<Set<string>> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const set = new Set<string>();
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const { email } = JSON.parse(line);
        if (email) set.add(String(email).toLowerCase());
      } catch {
        /* skip malformed line */
      }
    }
    return set;
  } catch {
    return new Set();
  }
}

/** Returns { added } — false if the email was already present. */
export async function addToWaitlist(
  email: string,
  meta: Record<string, unknown> = {},
): Promise<{ added: boolean }> {
  const normalized = email.toLowerCase();
  await fs.mkdir(DATA_DIR, { recursive: true });
  const existing = await readEmails();
  if (existing.has(normalized)) return { added: false };
  const record = JSON.stringify({ email: normalized, ts: new Date().toISOString(), ...meta });
  await fs.appendFile(FILE, record + "\n", "utf8");
  return { added: true };
}
