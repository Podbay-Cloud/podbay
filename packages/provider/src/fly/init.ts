import { promises as fs } from "node:fs";
import path from "node:path";
import type { ResolvedPod } from "@podbay/shared";
import type { FlyMachineFile } from "./api.js";

/**
 * The spec the in-pod init reads on first boot to seed config and run setup.
 * Deliberately carries NO credentials.
 */
export interface PodSpec {
  podId: string;
  /** The pod's memorable slug (== podId); the preview subdomain. */
  slug: string;
  /** User-chosen display name, or null (fall back to the slug). Used for the
   * remote-control session title so the app's session list matches the dashboard. */
  podName: string | null;
  /** `https://<slug>.<PODBAY_PREVIEW_BASE>`, or null when previews aren't configured. */
  previewUrl: string | null;
  /** This pod's cockpit page, e.g. `https://podbay.cloud/pods/<slug>`, so the agent can
   * hand the owner a REAL link (resize, secrets, settings) instead of "go to the
   * dashboard". Null when the app origin is unknown (local/dev). */
  cockpitUrl: string | null;
  /** Whether the preview is reachable by anyone (public) or owner-only. The env's
   * default; the `podbay` CLI + agent read THIS instead of assuming "owner-only". */
  previewPublic: boolean;
  /** Sleep policy (auto/awake-hours/always-on/scheduled) so the agent can tell the
   * user what persists and whether the pod sleeps. */
  lifecycle: ResolvedPod["lifecycle"]["default"];
  envName: string;
  capabilities: ResolvedPod["capabilities"];
  agents: ResolvedPod["agents"];
  agentAuth: ResolvedPod["agentAuth"];
  permissions: ResolvedPod["permissions"];
  network: ResolvedPod["network"];
  setup: string[];
  repo: ResolvedPod["repo"];
  /** BYO-repo: the user's chosen "owner/name" to clone into ~/work (or undefined). */
  githubRepo?: string;
  kickoff: ResolvedPod["kickoff"];
  egress: ResolvedPod["egress"];
  claudeFiles: string[]; // guest-relative paths of injected .claude files
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");

/**
 * Format app secrets as a bash-sourceable env file. Values are single-quoted
 * (embedded single quotes escaped `'\''`) so the file is safe to `. source`
 * under `set -a`. Keys are already validated UPPER_SNAKE by the env schema.
 */
export function toEnvFile(secrets: Record<string, string>): string {
  return (
    Object.keys(secrets)
      .sort()
      .map((k) => `${k}='${secrets[k].replace(/'/g, "'\\''")}'`)
      .join("\n") + "\n"
  );
}

/**
 * Build the Fly machine `files` to inject at boot: the pod-spec plus the
 * environment's `.claude/` layer (read from envDir if provided). The base
 * image's init reads /etc/podbay/pod-spec.json and applies these once.
 */
export async function buildInitFiles(
  input: {
    id: string;
    resolved: ResolvedPod;
    envDir?: string;
    name?: string;
    secrets?: Record<string, string>;
    githubRepo?: string;
    /** Pod-level agent override (multi-agent-plan.md slice 3); falls back to the
     * env's declared agents when absent. */
    agents?: ResolvedPod["agents"];
    /** Pod-level auth-mode override; falls back to the env's default when absent. */
    agentAuth?: ResolvedPod["agentAuth"];
  },
): Promise<FlyMachineFile[]> {
  const files: FlyMachineFile[] = [];
  const claudeFiles: string[] = [];

  // App secrets (per-pod). Written as a bash-sourceable env file; init.sh locks
  // it to 0600 dev-owned and sources it from ~/.bashrc. Normally empty at launch
  // (secrets are set post-launch) — the control plane re-injects on wake.
  const secrets = input.secrets ?? {};
  if (Object.keys(secrets).length > 0) {
    files.push({ guest_path: "/etc/podbay/secrets.env", raw_value: b64(toEnvFile(secrets)) });
  }

  if (input.envDir) {
    // The .claude layer = the SHARED buckets the env inherits (environments/_shared/
    // <bucket>/.claude, in declared order) merged with the env's own .claude, the
    // env winning on conflicts. Buckets let a generic env (byo-project → universal
    // only) skip the web-app kit while the web engines opt into it.
    // Keyed by relative path so a later layer overrides an earlier one.
    const claudeByRel = new Map<string, Buffer>();
    const walk = async (dir: string, rel: string) => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(path.join(dir, e.name), r);
        else claudeByRel.set(r, await fs.readFile(path.join(dir, e.name)));
      }
    };
    const sharedRoot = path.join(path.dirname(input.envDir), "_shared");
    // Declared buckets, in order (default handled by the schema: ["universal"]).
    for (const bucket of input.resolved.shared ?? ["universal"]) {
      await walk(path.join(sharedRoot, bucket, ".claude"), "");
    }
    await walk(path.join(input.envDir, ".claude"), ""); // env layer wins

    // Capability-gated skills. The universal layer is copied wholesale, so
    // `capabilities.webFetch` was decorative: the skill shipped to every pod
    // regardless, while the registry advertised it as "GATED by env capabilities
    // (default OFF)" and the schema said a plain code env has no business fetching
    // the web unprompted. A flag that gates only the marketing copy is worse than
    // no flag — it makes the spec lie. Enabling it is now what puts the skill on
    // the pod (and, under a restricted policy, what allows its hosts through).
    if (!input.resolved.capabilities?.webFetch?.enabled) {
      for (const rel of [...claudeByRel.keys()]) {
        if (rel.startsWith("skills/web-fetch/")) claudeByRel.delete(rel);
      }
    }
    for (const [r, content] of [...claudeByRel].sort(([a], [b]) => a.localeCompare(b))) {
      files.push({ guest_path: `/etc/podbay/claude/${r}`, raw_value: b64(content) });
      claudeFiles.push(`.claude/${r}`);
    }
  }

  // Preview URL: the provider computes it so the in-pod `podbay` CLI hardcodes
  // nothing. Base comes from PODBAY_PREVIEW_BASE (e.g. "preview.podbay.cloud");
  // unset (local/dev) → no preview URL.
  const previewBase = process.env.PODBAY_PREVIEW_BASE?.replace(/^\.+|\.+$/g, "");
  const previewUrl = previewBase ? `https://${input.id}.${previewBase}` : null;

  // The app origin (podbay.cloud): explicit override, else derived by stripping the
  // preview label (preview.podbay.cloud → podbay.cloud), same as the gateway does.
  const appOrigin =
    process.env.PODBAY_APP_ORIGIN?.replace(/\/$/, "") ||
    (previewBase && previewBase.split(".").length > 2
      ? `https://${previewBase.split(".").slice(1).join(".")}`
      : previewBase
        ? `https://${previewBase}`
        : null);
  const cockpitUrl = appOrigin ? `${appOrigin}/pods/${input.id}` : null;

  const spec: PodSpec = {
    podId: input.id,
    slug: input.id,
    podName: input.name?.trim() || null,
    previewUrl,
    cockpitUrl,
    previewPublic: input.resolved.preview === "public",
    lifecycle: input.resolved.lifecycle.default,
    envName: input.resolved.name,
    capabilities: input.resolved.capabilities,
    // The pod's chosen agent(s) win over the env default (multi-agent-plan.md slice 3);
    // this is the single point where the per-pod choice overrides the resolved env.
    agents: input.agents ?? input.resolved.agents,
    agentAuth: input.agentAuth ?? input.resolved.agentAuth,
    permissions: input.resolved.permissions,
    network: input.resolved.network,
    setup: input.resolved.setup,
    repo: input.resolved.repo,
    // BYO-repo: the USER's chosen repo (distinct from the env's `repo`) to clone
    // into ~/work at first boot; init.sh uses the PODBAY_GH_CLONE_TOKEN secret.
    githubRepo: input.githubRepo,
    kickoff: input.resolved.kickoff,
    egress: input.resolved.egress,
    claudeFiles: claudeFiles.sort(),
  };

  files.push({
    guest_path: "/etc/podbay/pod-spec.json",
    raw_value: b64(JSON.stringify(spec, null, 2)),
  });
  return files.sort((a, b) => a.guest_path.localeCompare(b.guest_path));
}
