import { promises as fs } from "node:fs";
import path from "node:path";
import { validateEnvironment } from "./validate.js";
import { PRESETS, type PermissionRules } from "./presets.js";
import { effectiveAllowlist, type EffectiveEgress, type NetworkPolicy } from "./egress.js";
import type { AgentAuth, AgentCli, Base, Environment, Network } from "./schema.js";

/**
 * The deterministic result of resolving an environment directory. The same
 * environment directory always yields a byte-identical ResolvedPod.
 */
export interface ResolvedPod {
  name: string;
  base: Base;
  agents: AgentCli[];
  /** Env default for agent auth; a per-pod launch choice overrides it. */
  agentAuth: AgentAuth;
  /** Ordered _shared/<bucket>/.claude layers to inherit before the env's own. */
  shared: string[];
  /** Lifecycle policy declared by the env: the default, and whether it's locked
   * (users can't change a locked policy at launch or after). */
  lifecycle: { default: "auto" | "awake-hours" | "always-on" | "scheduled"; locked: boolean };
  /** Default preview visibility for pods of this env (owner can flip per pod). */
  preview: "public" | "private";
  /** Env intentionally accepts a user's own GitHub repo at launch (BYO/oss). */
  byoRepo: boolean;
  /** Declared runtime capabilities, preserved for the launch/detail surfaces and
   * the in-pod spec. Dropping this at resolution made webFetch an inert YAML flag. */
  capabilities: Environment["capabilities"];
  network: Required<Pick<Network, "policy">> & { allow: string[] };
  env: Record<string, string>;
  /** Secret keys the app needs; the user supplies values per-pod (opsx pod-secrets). */
  secrets: { key: string; description: string | null; required: boolean; url: string | null }[];
  setup: string[];
  repo: { url: string; ref: string | null } | null;
  /** Agent-led onboarding prompt, or null. */
  kickoff: string | null;
  /** Enforced egress config derived from network.policy. */
  egress: EffectiveEgress;
  /** Effective permission rules, surfaced for inspection. */
  permissions: { preset: string; mode: string; rules: PermissionRules };
  /** Relative paths of the environment's .claude/ config layer (sorted). */
  claudeConfig: { present: boolean; files: string[] };
}

async function listClaudeConfig(envDir: string): Promise<string[]> {
  const root = path.join(envDir, ".claude");
  const out: string[] = [];
  async function walk(dir: string, rel: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r);
      else out.push(`.claude/${r}`);
    }
  }
  await walk(root, "");
  return out.sort();
}

/** Pure resolution: read an environment dir → normalized ResolvedPod. */
export async function resolve(envDir: string): Promise<ResolvedPod> {
  const yamlString = await fs.readFile(path.join(envDir, "podbay.yaml"), "utf8");
  const result = validateEnvironment(yamlString);
  if (!result.ok || !result.value) {
    throw new Error(`invalid environment at ${envDir}:\n  ${result.errors.join("\n  ")}`);
  }
  const env = result.value;
  const presetName = env.permissions.preset;

  return {
    name: env.name,
    lifecycle:
      typeof env.lifecycle === "string"
        ? { default: env.lifecycle, locked: false }
        : { default: env.lifecycle?.default ?? "auto", locked: env.lifecycle?.locked ?? false },
    preview: env.preview ?? "private",
    byoRepo: env.byoRepo ?? false,
    capabilities: {
      browserTesting: env.capabilities.browserTesting,
      webFetch: {
        enabled: env.capabilities.webFetch.enabled,
        ...(env.capabilities.webFetch.rungs
          ? { rungs: [...env.capabilities.webFetch.rungs] }
          : {}),
      },
    },
    base: env.base,
    agents: [...env.agents],
    agentAuth: env.agentAuth,
    shared: [...env.shared],
    network: {
      policy: env.network.policy,
      allow: env.network.policy === "custom" ? [...(env.network.allow ?? [])] : [],
    },
    env: env.env ? { ...env.env } : {},
    secrets: (env.secrets ?? []).map((s) => ({
      key: s.key,
      description: s.description ?? null,
      required: s.required,
      url: s.url ?? null,
    })),
    setup: env.setup ? [...env.setup] : [],
    repo: env.repo ? { url: env.repo.url, ref: env.repo.ref ?? null } : null,
    kickoff: env.kickoff ?? null,
    egress: effectiveAllowlist(env.network.policy as NetworkPolicy, env.network.allow ?? [], {
      enabled: env.capabilities.webFetch.enabled,
      ...(env.capabilities.webFetch.rungs ? { rungs: [...env.capabilities.webFetch.rungs] } : {}),
    }),
    permissions: { preset: presetName, mode: env.permissions.mode, rules: PRESETS[presetName] },
    claudeConfig: (() => ({ present: false, files: [] }))(), // filled below
  };
}

/**
 * Resolve and attach the .claude/ config listing. Kept separate from the pure
 * field mapping so the core resolution stays trivially deterministic.
 */
export async function resolveWithConfig(envDir: string): Promise<ResolvedPod> {
  const pod = await resolve(envDir);
  const files = await listClaudeConfig(envDir);
  pod.claudeConfig = { present: files.length > 0, files };
  return pod;
}

/** Stable, key-sorted serialization for determinism checks. */
export function serializeResolved(pod: ResolvedPod): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(pod), null, 2);
}
