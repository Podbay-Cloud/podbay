import { z } from "zod";
import { DEFAULT_PRESET } from "./presets.js";

/** Official agent CLIs a pod may run. No third-party harnesses (ToS). */
export const AgentCli = z.enum(["claude-code", "codex"]);
export type AgentCli = z.infer<typeof AgentCli>;

/** How a pod authenticates its agent CLI: the user's subscription `/login` (default),
 * or a BYO API key. API-key mode is the ToS-clean home for unattended / agent-to-agent
 * automation and escapes the subscription OAuth-rotation fragility — see
 * docs/plans/api-key-pod-mode.md. A per-pod choice by default (the key is a user secret);
 * an env may set a default. */
export const AgentAuth = z.enum(["subscription", "api-key", "setup-token"]);
export type AgentAuth = z.infer<typeof AgentAuth>;

const kebab = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be kebab-case (a-z, 0-9, hyphens)");

/** Base image source — exactly one of image | dockerfile | devcontainer. */
export const Base = z
  .object({
    image: z.string().min(1).optional(),
    dockerfile: z.string().min(1).optional(),
    devcontainer: z.string().min(1).optional(),
  })
  .refine(
    (b) => [b.image, b.dockerfile, b.devcontainer].filter(Boolean).length === 1,
    { message: "base must set exactly one of: image, dockerfile, devcontainer" },
  );
export type Base = z.infer<typeof Base>;

/** CLI permission mode passed to the agent. `acceptEdits` (default) auto-accepts
 * file edits but still prompts on sensitive-file writes and irreversible actions;
 * `bypassPermissions` skips ALL prompts (only for trusted, first-party envs —
 * removes the token-exfil/data-loss guards); `dontAsk` proceeds without prompting
 * while still applying deny rules. */
export const PermissionMode = z.enum(["acceptEdits", "bypassPermissions", "dontAsk", "plan"]);

export const Permissions = z.object({
  preset: z.enum([DEFAULT_PRESET]).default(DEFAULT_PRESET),
  mode: PermissionMode.default("acceptEdits"),
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
  ask: z.array(z.string()).optional(),
});

export const Network = z
  .object({
    policy: z.enum(["none", "trusted", "full", "custom"]).default("trusted"),
    allow: z.array(z.string()).optional(),
  })
  .refine((n) => n.policy !== "custom" || (n.allow?.length ?? 0) > 0, {
    message: "network.policy 'custom' requires a non-empty allow list",
  });
export type Network = z.infer<typeof Network>;

export const Repo = z.object({
  url: z.string().min(1),
  ref: z.string().min(1).optional(),
});

export const Metadata = z.object({
  /** Human display name for the catalog (e.g. "BYO Project"). Falls back to the
   * kebab-case `name` when unset. The `name` stays the stable id used in URLs. */
  title: z.string().max(60).optional(),
  description: z.string().optional(),
  author: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

/**
 * A secret the env's app needs at runtime. The env declares the KEY (an env-var
 * name); the user supplies the VALUE per pod, encrypted (see opsx pod-secrets).
 * Values are never part of the environment definition.
 */
export const SecretDecl = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9_]*$/, "secret key must be UPPER_SNAKE_CASE"),
  description: z.string().max(200).optional(),
  required: z.boolean().default(false),
  /** Optional https link to where the user can obtain this value (e.g. the
   * provider's API-keys page). Shown as a "Get it ↗" link next to the field. */
  url: z.string().url().startsWith("https://").max(300).optional(),
});

export const LifecyclePolicyEnum = z.enum(["auto", "awake-hours", "always-on", "scheduled"]);
/** Either a bare policy (unlocked default) or `{ default, locked }`. */
export const LifecycleDecl = z.union([
  LifecyclePolicyEnum,
  z.object({ default: LifecyclePolicyEnum, locked: z.boolean().default(false) }),
]);

/**
 * podbay.yaml v0. Passthrough (not strict) so unknown fields warn rather than
 * hard-fail — forward compatibility. The credential denylist in validate.ts is
 * what hard-fails; it runs independently of this schema.
 */
/** Rungs of the web-fetch ladder, cheapest-and-cleanest first (see the web-fetch spec):
 * `api` official/structured APIs · `direct` plain pod fetch (+ headless render) ·
 * `archive` published archives/datasets · `service` third-party reader that fetches from
 * its own infra · `relay` the owner's own device/session. */
export const WebFetchRung = z.enum(["api", "direct", "archive", "service", "relay"]);
export type WebFetchRung = z.infer<typeof WebFetchRung>;

export const EnvironmentSchema = z
  .object({
    apiVersion: z.literal("podbay/v0"),
    name: kebab,
    /** Two-layer marketplace model (docs/strategy/marketplace-playbooks.md): `playbook` =
     * an outcome tile shown on the demand catalog; `engine` = invisible
     * capability substrate a playbook rides (e.g. the web-app engine), hidden
     * from the demand catalog and surfaced only on the supply/creator surface.
     * Defaults to `playbook` so an unmarked env stays a launchable tile. */
    kind: z.enum(["playbook", "engine"]).default("playbook"),
    /** Which environments/_shared/<bucket>/.claude layers to inherit, in order,
     * before the env's own .claude (which wins). `universal` = every pod;
     * `web-app` = the shadcn/frontend-design/webapp kit for the web engines.
     * Room to add `python`, `rust`, etc. later. Default: universal only, so a
     * generic env (byo-project) doesn't inherit web-app skills it can't use. */
    shared: z.array(kebab).default(["universal"]),
    base: Base,
    agents: z.array(AgentCli).nonempty().default(["claude-code"]),
    /** Env default for how pods authenticate their agent; overridable per pod at launch. */
    agentAuth: AgentAuth.default("subscription"),
    permissions: Permissions.default({ preset: DEFAULT_PRESET }),
    network: Network.default({ policy: "trusted" }),
    /** Lifecycle policy for pods of this env. A bare policy is an unlocked default
     * the user can change; `{ default, locked: true }` forces it (a Discord-bot env
     * is `{ default: always-on, locked: true }`). */
    lifecycle: LifecycleDecl.default("auto"),
    /** Default preview visibility for pods of this env. `public` = the pod's
     * preview URL is reachable by anyone with the link from launch (for envs
     * whose whole point is a shareable page — e.g. a landing). Private surfaces
     * must gate themselves in-app (see first-10-customers' /crm). Defaults to
     * `private` (owner-only). The user can still flip it per pod afterward. */
    preview: z.enum(["public", "private"]).default("private"),
    /** Whether this env intentionally accepts a user's own GitHub repo at launch
     * (the "Bring a GitHub repo" picker). Only byo/oss-style engines set it — envs
     * with a prebuilt ~/work app leave it false so the field never shows. */
    byoRepo: z.boolean().default(false),
    /** What the pod IMAGE must provide for this env's agent to do its job.
     *
     * ⚠ Today every env boots ONE shared `pod-base` image, so this does NOT change
     * what ships — declaring `browserTesting: false` saves no bytes. It declares
     * INTENT, and its job right now is to keep the agent's instructions HONEST:
     * `_shared/universal` promises "Chromium is prebaked", which was false on every
     * Incus pod until 2026-07-27 and sent agents down a `libnspr4.so` rabbit hole.
     *
     * Defaults to `true` because every current env ships a web UI, and `byo-project`
     * can't know what repo arrives. A future rust/go/mobile env sets it false; when
     * a genuinely lean env exists, this field is the signal that would drive per-env
     * image variants — build that when there's a workload to size it against, not now. */
    capabilities: z
      .object({
        browserTesting: z.boolean().default(true),
        /** Web-fetch/research capability (openspec/changes/web-fetch-capability).
         * OFF by default: a plain code env has no business fetching the web unprompted.
         * `rungs` optionally RESTRICTS which methods the ladder may use — omit to allow
         * all. The restriction is a real privacy control, not decoration: an env handling
         * private material can allow `[api, direct]` so no URL is ever handed to a
         * third-party reader service. */
        webFetch: z
          .object({
            enabled: z.boolean().default(false),
            rungs: z.array(WebFetchRung).nonempty().optional(),
          })
          .default({ enabled: false }),
      })
      .default({ browserTesting: true, webFetch: { enabled: false } }),
    env: z.record(z.string(), z.string()).optional(),
    /** Secret keys the app needs; values are supplied per-pod by the user. */
    secrets: z.array(SecretDecl).optional(),
    setup: z.array(z.string()).optional(),
    repo: Repo.optional(),
    /** Prompt the agent CLI starts with once authenticated — the env author's
     * disclosed, first-party onboarding. Shown verbatim wherever the env is
     * presented. */
    kickoff: z.string().min(1).max(6000).optional(),
    metadata: Metadata.optional(),
  })
  .passthrough();

export type EnvironmentInput = z.input<typeof EnvironmentSchema>;
export type Environment = z.infer<typeof EnvironmentSchema>;

/** Top-level keys the schema knows about; anything else warns. */
export const KNOWN_TOP_LEVEL_KEYS = [
  "apiVersion",
  "name",
  "kind",
  // `shared` and `byoRepo` were added to the schema but never here, so every env
  // using them (byo-project ships both) drew a bogus "unknown field … ignored"
  // warning. Latent only because lint-envs calls resolveWithConfig, which skips
  // the warning path — so nothing surfaced it. Keep this list in step with the
  // schema object above.
  "shared",
  "byoRepo",
  "capabilities",
  "base",
  "agents",
  "agentAuth",
  "permissions",
  "network",
  "lifecycle",
  "preview",
  "env",
  "secrets",
  "setup",
  "repo",
  "kickoff",
  "metadata",
] as const;
