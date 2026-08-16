import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { validateEnvironment, resolveWithConfig } from "@podbay/shared";

export interface DeclaredSecret {
  key: string;
  description: string | null;
  required: boolean;
  /** Optional https link to where to obtain this value (provider's keys page). */
  url: string | null;
}

/** A one-line summary of what a pod comes with, derived from the env (not authored). */
export interface Capability {
  agents: string[]; // display names, e.g. "Claude Code"
  base: string; // "devcontainer" | "image (…)" | "dockerfile"
  webFetch: boolean;
  secretCount: number;
  requiredSecretCount: number;
}

export interface EnvLifecycle {
  default: string;
  locked: boolean;
}

export interface CatalogEntry {
  /** Stable kebab-case id (used in URLs / ?env=). */
  name: string;
  /** Human display name for the catalog; falls back to `name` when unset. */
  title: string;
  /** `playbook` = demand tile; `engine` = invisible substrate (hidden from the
   * demand catalog). See docs/strategy/marketplace-playbooks.md. */
  kind: "playbook" | "engine";
  description: string;
  author: string | null;
  tags: string[];
  /** Secrets the env declares — drives the launch dialog's required fields. */
  secrets: DeclaredSecret[];
  capability: Capability;
  /** Lifecycle policy: the env default and whether it's locked (drives the picker). */
  lifecycle: EnvLifecycle;
}

function normalizeLifecycle(raw: unknown): EnvLifecycle {
  if (!raw) return { default: "auto", locked: false };
  if (typeof raw === "string") return { default: raw, locked: false };
  const o = raw as { default?: string; locked?: boolean };
  return { default: o.default ?? "auto", locked: o.locked ?? false };
}

/** Full pitch for one env's detail page — the capability summary plus the wired
 * `.claude` layer (skills + rules), derived from the resolved env. */
export interface EnvironmentDetail extends CatalogEntry {
  network: string;
  skills: string[];
  rules: string[];
  /** Env intentionally accepts a BYO GitHub repo at launch (gates the picker). */
  byoRepo: boolean;
  /** Raw agent CLI ids the env declares (e.g. ["claude-code"]) — the launch agent
   * picker's options (multi-agent-plan.md slice 3). `agents` above is the display form. */
  agentIds: string[];
}

const AGENT_LABELS: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex" };

function agentLabels(agents: readonly string[]): string[] {
  return agents.map((a) => AGENT_LABELS[a] ?? a);
}

function baseKind(base: { image?: string; dockerfile?: string; devcontainer?: string }): string {
  if (base.devcontainer) return "devcontainer";
  if (base.dockerfile) return "dockerfile";
  if (base.image) return `image (${base.image})`;
  return "custom";
}

function toDeclaredSecrets(
  secrets:
    | { key: string; description?: string | null; required?: boolean; url?: string | null }[]
    | undefined,
): DeclaredSecret[] {
  return (secrets ?? []).map((s) => ({
    key: s.key,
    description: s.description ?? null,
    required: s.required ?? false,
    url: s.url ?? null,
  }));
}

/** Where the first-party environments live at runtime. */
export function getEnvironmentsRoot(): string {
  return (
    process.env.PODBAY_ENVIRONMENTS_ROOT ?? path.join(process.cwd(), "..", "..", "environments")
  );
}

/** Read the environment catalog: valid environments with display metadata. Skips invalid dirs. */
export async function listEnvironments(root = getEnvironmentsRoot()): Promise<CatalogEntry[]> {
  let names: string[];
  try {
    names = (await fs.readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  const out: CatalogEntry[] = [];
  for (const name of names) {
    let yaml: string;
    try {
      yaml = await fs.readFile(path.join(root, name, "podbay.yaml"), "utf8");
    } catch {
      continue; // not an environment
    }
    const result = validateEnvironment(yaml);
    if (!result.ok || !result.value) continue;
    const env = result.value;
    const meta = env.metadata ?? {};
    const secrets = toDeclaredSecrets(env.secrets);
    out.push({
      name: env.name,
      title: meta.title ?? env.name,
      kind: env.kind ?? "playbook",
      description: meta.description ?? "",
      author: meta.author ?? null,
      tags: meta.tags ?? [],
      secrets,
      capability: {
        agents: agentLabels(env.agents ?? []),
        base: baseKind(env.base ?? {}),
        webFetch: env.capabilities.webFetch.enabled,
        secretCount: secrets.length,
        requiredSecretCount: secrets.filter((s) => s.required).length,
      },
      lifecycle: normalizeLifecycle(env.lifecycle),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Resolve one env to its full detail pitch, or null if unknown/invalid. */
export async function getEnvironmentDetail(
  name: string,
  root = getEnvironmentsRoot(),
): Promise<EnvironmentDetail | null> {
  // Guard against traversal — env names are single path segments.
  if (!name || name.includes("/") || name.includes("..")) return null;
  const dir = path.join(root, name);
  let yaml: string;
  try {
    yaml = await fs.readFile(path.join(dir, "podbay.yaml"), "utf8");
  } catch {
    return null;
  }
  const result = validateEnvironment(yaml);
  if (!result.ok || !result.value) return null;
  const meta = result.value.metadata ?? {};

  let resolved;
  try {
    resolved = await resolveWithConfig(dir);
  } catch {
    return null;
  }
  const secrets = toDeclaredSecrets(resolved.secrets);
  // Derive skill + rule names from the wired .claude layer paths.
  const files = resolved.claudeConfig?.files ?? [];
  const skills = files
    .map((f) => f.match(/^\.claude\/skills\/([^/]+)\/SKILL\.md$/i)?.[1])
    .filter((s): s is string => !!s);
  const rules = files
    .map((f) => f.match(/^\.claude\/rules\/([^/]+)\.md$/i)?.[1])
    .filter((s): s is string => !!s);

  return {
    name: resolved.name,
    title: meta.title ?? resolved.name,
    kind: (result.value.kind ?? "playbook") as "playbook" | "engine",
    description: meta.description ?? "",
    author: meta.author ?? null,
    tags: meta.tags ?? [],
    secrets,
    capability: {
      agents: agentLabels(resolved.agents ?? []),
      base: baseKind(resolved.base ?? {}),
      webFetch: resolved.capabilities.webFetch.enabled,
      secretCount: secrets.length,
      requiredSecretCount: secrets.filter((s) => s.required).length,
    },
    lifecycle: { default: resolved.lifecycle.default, locked: resolved.lifecycle.locked },
    network: resolved.network?.policy ?? "full",
    skills,
    rules,
    byoRepo: resolved.byoRepo,
    agentIds: [...(resolved.agents ?? [])],
  };
}
